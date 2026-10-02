import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "xclone-88968";
const JOB_BATCH = 100;
const JOB_CONCURRENCY = 4;
const TOKEN_CONCURRENCY = 4;
const MAX_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

async function vault(name: string): Promise<string | null> {
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/get_secret_for_worker", {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: "Bearer " + SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ secret_name: name }),
  });
  if (!response.ok) return null;
  return await response.json() as string;
}

async function serviceAccount() {
  const raw =
    Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ??
    await vault("firebase_service_account_json");

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not configured in Supabase Edge secrets or firebase_service_account_json is not configured in Supabase Vault",
    );
  }

  let parsed: {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };

  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }

  if (parsed.project_id && parsed.project_id !== FIREBASE_PROJECT_ID) {
    throw new Error(
      "Firebase project mismatch: credential belongs to " +
        parsed.project_id +
        " but FIREBASE_PROJECT_ID is " +
        FIREBASE_PROJECT_ID,
    );
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

async function accessToken(account: { client_email: string; private_key: string }) {
  const key = await importPKCS8(account.private_key, "RS256");
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error("Firebase OAuth failed: " + JSON.stringify(payload).slice(0, 500));
  }
  return payload.access_token as string;
}

async function sendFcm(
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
  bearer: string,
) {
  const response = await fetch(
    "https://fcm.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/messages:send",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + bearer,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "testagram_notifications",
              sound: "default",
              default_vibrate_timings: true,
              notification_priority: "PRIORITY_HIGH",
            },
          },
        },
      }),
    },
  );
  const payload = await response.text();
  if (!response.ok) throw new Error("FCM " + response.status + ": " + payload.slice(0, 800));
  return payload;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), items.length || 1) },
      () => runner(),
    ),
  );
  return results;
}

function retryAt(attempt: number) {
  const delayMs = Math.min(15 * 60 * 1000, 15 * 1000 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

async function reclaimStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const result = await db
    .from("notification_delivery_outbox")
    .update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      last_error: "Reclaimed stale processing lease",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .limit(JOB_BATCH);
  if (result.error) throw result.error;
}

type Job = {
  id: string;
  notification_id: string;
  recipient_id: string;
  event_name: string;
  payload: Record<string, unknown>;
  attempts: number;
};

async function processJob(
  job: Job,
  bearer: string,
): Promise<{ sent: number; failed: number; disabled: number }> {
  const claim = await db
    .from("notification_delivery_outbox")
    .update({
      status: "processing",
      attempts: (job.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claim.error || !claim.data) return { sent: 0, failed: 0, disabled: 0 };

  const attempt = (job.attempts ?? 0) + 1;
  const payload = job.payload ?? {};
  const title = String(payload.title ?? "Testagram");
  const body = String(payload.body ?? "You have a new notification.");
  const url = String(payload.action_url ?? payload.url ?? "https://testagram.site/notifications");

  const tokensResult = await db
    .from("app_push_tokens")
    .select("id,token")
    .eq("user_id", job.recipient_id)
    .eq("provider", "fcm")
    .eq("platform", "android")
    .eq("enabled", true);

  if (tokensResult.error) throw tokensResult.error;

  const tokens = tokensResult.data ?? [];
  if (!tokens.length) {
    await db
      .from("notification_delivery_outbox")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "processing");
    return { sent: 0, failed: 0, disabled: 0 };
  }

  const outcomes = await mapWithConcurrency(tokens, TOKEN_CONCURRENCY, async (tokenRow) => {
    try {
      await sendFcm(
        String(tokenRow.token),
        title,
        body,
        {
          notification_id: String(job.notification_id),
          event_name: String(job.event_name ?? "notification"),
          action_url: url,
          deep_link: url,
        },
        bearer,
      );
      return { tokenId: tokenRow.id, status: "sent" as const, error: null as string | null };
    } catch (error) {
      return {
        tokenId: tokenRow.id,
        status: "failed" as const,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      };
    }
  });

  const badTokenIds = outcomes
    .filter(
      (outcome) =>
        outcome.status === "failed" &&
        /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/i.test(outcome.error ?? ""),
    )
    .map((outcome) => outcome.tokenId);

  if (badTokenIds.length) {
    const disabled = await db
      .from("app_push_tokens")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in("id", badTokenIds);
    if (disabled.error) throw disabled.error;
  }

  const deliveryRows = outcomes.map((outcome) => ({
    notification_id: job.notification_id,
    push_token_id: outcome.tokenId,
    provider: "fcm",
    status:
      outcome.status === "sent"
        ? "sent"
        : badTokenIds.includes(outcome.tokenId)
          ? "disabled"
          : "failed",
    attempts: attempt,
    last_error: outcome.error,
    next_attempt_at:
      outcome.status === "sent" || badTokenIds.includes(outcome.tokenId)
        ? null
        : retryAt(attempt),
    sent_at: outcome.status === "sent" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }));

  const deliveryWrite = await db
    .from("notification_push_deliveries")
    .upsert(deliveryRows, { onConflict: "notification_id,push_token_id" });
  if (deliveryWrite.error) throw deliveryWrite.error;

  const failed = outcomes.filter(
    (outcome) => outcome.status === "failed" && !badTokenIds.includes(outcome.tokenId),
  ).length;
  const sent = outcomes.length - outcomes.filter((outcome) => outcome.status === "failed").length;
  const exhausted = attempt >= MAX_ATTEMPTS;
  const finalStatus = failed === 0 ? "sent" : exhausted ? "failed" : "pending";

  const jobUpdate = await db
    .from("notification_delivery_outbox")
    .update({
      status: finalStatus,
      sent_at: finalStatus === "sent" ? new Date().toISOString() : null,
      last_error: failed ? failed + " FCM delivery attempt(s) failed" : null,
      next_attempt_at: finalStatus === "pending" ? retryAt(attempt) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "processing");

  if (jobUpdate.error) throw jobUpdate.error;

  return { sent, failed, disabled: badTokenIds.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required" });

  const expected = await vault("notification_worker_token");
  if (!expected || req.headers.get("x-notification-worker-token") !== expected) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "server_not_configured" });
  }

  try {
    await reclaimStaleJobs();

    const account = await serviceAccount();
    const bearer = await accessToken(account);

    const queue = await db
      .from("notification_delivery_outbox")
      .select("id,notification_id,recipient_id,event_name,payload,attempts")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(JOB_BATCH);

    if (queue.error) throw queue.error;

    const results = await mapWithConcurrency(
      (queue.data ?? []) as Job[],
      JOB_CONCURRENCY,
      (job) => processJob(job, bearer),
    );

    return json(200, {
      ok: true,
      jobs: queue.data?.length ?? 0,
      sent: results.reduce((sum, result) => sum + result.sent, 0),
      failed: results.reduce((sum, result) => sum + result.failed, 0),
      disabled: results.reduce((sum, result) => sum + result.disabled, 0),
      concurrency: { jobs: JOB_CONCURRENCY, tokens: TOKEN_CONCURRENCY },
    });
  } catch (error) {
    console.error("[notification-fcm-worker]", error);
    return json(502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
