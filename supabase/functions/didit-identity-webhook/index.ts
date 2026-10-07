import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY =
  secretKeys.default ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") ||
  "";
const DIDIT_API_KEY = Deno.env.get("DIDIT_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("DIDIT_WEBHOOK_SECRET") ?? "";
const IDENTITY_SECRET = Deno.env.get("IDENTITY_PREAUTH_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EVENT_TYPES = new Set([
  "status.updated",
  "data.updated",
  "user.status.updated",
  "user.data.updated",
  "business.status.updated",
  "business.data.updated",
  "activity.created",
  "transaction.created",
  "transaction.status.updated",
]);

const TERMINAL_STATUSES = new Set([
  "Approved",
  "Declined",
  "Expired",
  "Abandoned",
  "KYC Expired",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string) {
  const normalize = (value: string) =>
    value.trim().toLowerCase().replace(/^sha256=/, "");
  const left = normalize(a);
  const right = normalize(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.keys(object)
      .sort()
      .reduce<Record<string, unknown>>((out, key) => {
        out[key] = sortKeys(object[key]);
        return out;
      }, {});
  }
  return value;
}

async function hmacHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/*
 * The raw request bytes are read exactly once and never replaced. X-Signature
 * authenticates those bytes directly. X-Signature-V2 authenticates Didit's
 * recursively sorted JSON representation; parsing is performed only after the
 * raw body has been captured and the timestamp freshness check has passed.
 */
async function verifySignature(
  raw: string,
  payload: Record<string, unknown>,
  timestampHeader: string,
  signatureV2: string,
  signatureLegacy: string,
  signatureSimple: string,
) {
  if (!WEBHOOK_SECRET || !timestampHeader) return false;

  const headerTimestamp = Number(timestampHeader);
  if (
    !Number.isFinite(headerTimestamp) ||
    Math.abs(Math.floor(Date.now() / 1000) - Math.trunc(headerTimestamp)) > 300
  ) return false;

  const payloadTimestamp = payload.timestamp;
  if (
    payloadTimestamp !== undefined &&
    String(payloadTimestamp) !== timestampHeader
  ) return false;

  if (signatureV2) {
    const canonical = JSON.stringify(sortKeys(payload));
    if (safeEqual(await hmacHex(canonical, WEBHOOK_SECRET), signatureV2)) {
      return true;
    }
  }

  if (
    signatureLegacy &&
    safeEqual(await hmacHex(raw, WEBHOOK_SECRET), signatureLegacy)
  ) {
    return true;
  }

  if (signatureSimple) {
    const simpleData = [
      timestampHeader,
      String(payload.session_id ?? ""),
      String(payload.status ?? ""),
      String(payload.webhook_type ?? ""),
    ].join(":");
    if (safeEqual(await hmacHex(simpleData, WEBHOOK_SECRET), signatureSimple)) {
      return true;
    }
  }

  return false;
}

async function idHmac(id: string) {
  if (!IDENTITY_SECRET) throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");
  return "\\x" + await hmacHex("ke-nid|" + id, IDENTITY_SECRET);
}

function findWarnings(decision: any): string[] {
  const warnings: string[] = [];
  for (const key of [
    "id_verifications",
    "nfc_verifications",
    "liveness_checks",
    "face_matches",
    "aml_screenings",
    "poa_verifications",
    "phone_verifications",
    "email_verifications",
    "ip_analyses",
    "database_validations",
    "reviews",
  ]) {
    for (const feature of Array.isArray(decision?.[key])
      ? decision[key]
      : []) {
      for (const warning of Array.isArray(feature?.warnings)
        ? feature.warnings
        : []) {
        if (typeof warning?.risk === "string") warnings.push(warning.risk);
      }
    }
  }
  return warnings;
}

function normalizeId(value: unknown) {
  const id = String(value ?? "").replace(/\D/g, "");
  return /^\d{6,12}$/.test(id) ? id : "";
}

function normalizeDob(value: unknown) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function findId(decision: any) {
  const items = Array.isArray(decision?.id_verifications)
    ? decision.id_verifications
    : [];
  const approved = items.find((x: any) => x?.status === "Approved") ?? items[0];
  if (!approved) return null;

  const document = normalizeId(approved.document_number);
  const personal = normalizeId(approved.personal_number);
  const mrz = normalizeId(approved.mrz?.document_number);
  const id = document || personal || mrz;

  return {
    id,
    last4: id.slice(-4),
    dob: normalizeDob(approved.date_of_birth),
    issuingState:
      typeof approved.issuing_state === "string"
        ? approved.issuing_state
        : null,
    documentType:
      typeof approved.document_type === "string"
        ? approved.document_type
        : null,
  };
}

async function deleteDiditSession(sessionId: string) {
  if (!DIDIT_API_KEY || !sessionId) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(
      "https://verification.didit.me/v3/session/" +
        encodeURIComponent(sessionId) +
        "/delete/",
      {
        method: "DELETE",
        headers: { "x-api-key": DIDIT_API_KEY },
        signal: controller.signal,
      },
    );
  } catch (error) {
    console.error(
      "DIDIT_SESSION_DELETE_FAILED",
      JSON.stringify({
        session_id: sessionId,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      }),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function processEvent(
  payload: Record<string, any>,
  eventId: string,
  webhookType: string,
) {
  const sessionId = String(payload.session_id ?? "");
  const status = String(payload.status ?? "");
  const decision = payload.decision ?? {};
  const warnings = findWarnings(decision);

  // Entity/activity/transaction events are still durably recorded even when
  // they do not carry a session status. This keeps the webhook contract broad
  // without granting an entity event permission to change KYC state.
  if (webhookType !== "status.updated" && webhookType !== "data.updated") {
    const { error } = await admin.from("identity_verification_events").insert({
      provider_event_id: eventId,
      event_type: webhookType,
      outcome: status || webhookType,
      request_id: eventId,
      user_id: null,
      actor_id: null,
      metadata: {
        webhook_type: webhookType,
        session_id: sessionId || null,
        business_session_id: payload.business_session_id ?? null,
        session_kind: payload.session_kind ?? null,
        application_id: payload.application_id ?? null,
        workflow_id: payload.workflow_id ?? null,
        workflow_version: payload.workflow_version ?? null,
        vendor_data: payload.vendor_data ?? null,
        created_at: payload.created_at ?? null,
        transaction_id: payload.transaction_id ?? null,
        entity_id: payload.user_id ?? payload.entity_id ?? null,
        status: status || null,
        decision,
      },
    });
    if (error && error.code !== "23505") throw error;
    return;
  }

  if (!sessionId) return;

  const { data: intent, error: intentError } = await admin
    .schema("private")
    .from("identity_signup_intents")
    .select("*")
    .eq("didit_session_id", sessionId)
    .maybeSingle();

  if (intentError) throw intentError;

  // A valid Didit event may belong to an already-created account or to a
  // different Didit workflow. Keep it auditable but do not mutate Testagram.
  if (!intent) {
    const { error } = await admin.from("identity_verification_events").insert({
      provider_event_id: eventId,
      event_type: webhookType,
      outcome: status || webhookType,
      request_id: eventId,
      user_id: null,
      actor_id: null,
      metadata: {
        webhook_type: webhookType,
        session_id: sessionId,
        status: status || null,
        decision,
        ignored: true,
      },
    });
    if (error && error.code !== "23505") throw error;
    return;
  }

  if (intent.identity_status === "approved" && webhookType === "status.updated") {
    return;
  }

  let identityStatus = intent.identity_status;
  let rejectionReason: string | null = null;
  const providerReference = sessionId;
  let fingerprint: string | null = null;
  let last4: string | null = null;
  let verifiedDob: string | null = null;

  if (webhookType === "status.updated") {
    if (status === "Approved") {
      const extracted = findId(decision);
      if (
        !extracted?.id ||
        extracted.issuingState !== "KEN" ||
        !/identity\s*card/i.test(extracted.documentType || "")
      ) {
        identityStatus = "rejected";
        rejectionReason = "IDENTITY_DATA_MISSING_OR_UNEXPECTED_DOCUMENT";
      } else if (
        !extracted.dob ||
        extracted.dob !== intent.birth_date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(extracted.dob)
      ) {
        identityStatus = "rejected";
        rejectionReason = "BIRTH_DATE_MISMATCH";
      } else if (
        warnings.includes("POSSIBLE_DUPLICATED_FACE") ||
        warnings.includes("FACE_IN_BLOCKLIST")
      ) {
        identityStatus = "blocked";
        rejectionReason =
          warnings.find(
            (w) =>
              w === "POSSIBLE_DUPLICATED_FACE" || w === "FACE_IN_BLOCKLIST",
          ) || "DUPLICATE_FACE";
      } else {
        fingerprint = await idHmac(extracted.id);
        last4 = extracted.last4;
        verifiedDob = extracted.dob;

        const { data: duplicate } = await admin
          .from("identity_verifications")
          .select("id,user_id")
          .eq("id_number_hmac", fingerprint)
          .maybeSingle();

        if (duplicate && duplicate.user_id !== intent.completed_user_id) {
          identityStatus = "blocked";
          rejectionReason = "IDENTITY_ALREADY_REGISTERED";
        } else {
          identityStatus = "approved";
        }
      }
    } else if (status === "In Review") {
      identityStatus = "under_review";
    } else if (status === "Declined") {
      identityStatus = "rejected";
      rejectionReason = warnings[0] || "DIDIT_DECLINED";
    } else if (
      status === "Resubmitted" ||
      status === "In Progress" ||
      status === "Not Started"
    ) {
      identityStatus = "pending";
    } else if (status === "Expired" || status === "Abandoned") {
      identityStatus = "rejected";
      rejectionReason = "VERIFICATION_SESSION_ENDED";
    } else if (status === "KYC Expired") {
      identityStatus = "rejected";
      rejectionReason = "KYC_EXPIRED";
    }
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    didit_status: status || intent.didit_status,
    identity_status: identityStatus,
    provider_reference: providerReference,
    rejection_reason: rejectionReason,
    updated_at: now,
  };

  if (fingerprint) {
    Object.assign(updatePayload, {
      id_number_hmac: fingerprint,
      id_number_last4: last4,
      verified_birth_date: verifiedDob,
    });
  }

  const { error: updateError } = await admin
    .schema("private")
    .from("identity_signup_intents")
    .update(updatePayload)
    .eq("id", intent.id);

  if (updateError) throw updateError;

  if (identityStatus === "approved" && intent.completed_user_id && fingerprint) {
    const { error: identityError } = await admin
      .from("identity_verifications")
      .upsert(
        {
          user_id: intent.completed_user_id,
          id_type: "ke_national_id",
          id_number_hmac: fingerprint,
          id_number_last4: last4,
          country_code: "KE",
          status: "approved",
          verification_method: "provider",
          provider: "didit",
          provider_reference: providerReference,
          submitted_at: now,
          reviewed_at: now,
          email_snapshot: intent.email,
        },
        { onConflict: "user_id" },
      );

    if (identityError) {
      if (identityError.code === "23505") {
        await admin
          .schema("private")
          .from("identity_signup_intents")
          .update({
            identity_status: "blocked",
            rejection_reason: "IDENTITY_ALREADY_REGISTERED",
            updated_at: now,
          })
          .eq("id", intent.id);
        identityStatus = "blocked";
        rejectionReason = "IDENTITY_ALREADY_REGISTERED";
      } else {
        throw identityError;
      }
    } else {
      const { error: profileError } = await admin
        .from("profiles")
        .update({
          birth_date: verifiedDob,
          identity_verification_status: "approved",
          identity_verified_at: now,
        })
        .eq("id", intent.completed_user_id);
      if (profileError) throw profileError;
    }
  }

  const { error: eventInsertError } = await admin
    .from("identity_verification_events")
    .insert({
      provider_event_id: eventId,
      event_type: webhookType,
      outcome: identityStatus,
      request_id: eventId,
      user_id: intent.completed_user_id ?? null,
      actor_id: null,
      metadata: {
        session_id: sessionId,
        registration_intent_id: intent.id,
        status,
        warnings: warnings.slice(0, 20),
        webhook_type: webhookType,
        rejection_reason: rejectionReason,
        id_last4: last4,
        decision,
      },
    });

  if (eventInsertError && eventInsertError.code !== "23505") {
    throw eventInsertError;
  }

  if (TERMINAL_STATUSES.has(status)) {
    await deleteDiditSession(sessionId);
  }
}

async function recordAndProcess(
  payload: Record<string, any>,
  eventId: string,
  webhookType: string,
  rawBodyHash: string,
) {
  // The existing identity_verification_events unique provider_event_id index is
  // the durable idempotency key. Each retry remains visible through logs.
  const { data: existing } = await admin
    .from("identity_verification_events")
    .select("id")
    .eq("provider_event_id", eventId)
    .maybeSingle();

  if (existing) return;

  await processEvent(payload, eventId, webhookType);

  console.log(
    "DIDIT_WEBHOOK_PROCESSED",
    JSON.stringify({
      event_id: eventId,
      webhook_type: webhookType,
      raw_body_sha256: rawBodyHash,
    }),
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  if (!SERVICE_KEY || !IDENTITY_SECRET || !WEBHOOK_SECRET) {
    return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  }

  try {
    const timestampHeader = req.headers.get("X-Timestamp") ?? "";
    const signatureV2 = req.headers.get("X-Signature-V2") ?? "";
    const signatureLegacy = req.headers.get("X-Signature") ?? "";
    const signatureSimple = req.headers.get("X-Signature-Simple") ?? "";
    const raw = await req.text();

    if (!timestampHeader) {
      return json({ ok: false, error: "MISSING_TIMESTAMP" }, 401);
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    if (
      !(await verifySignature(
        raw,
        payload,
        timestampHeader,
        signatureV2,
        signatureLegacy,
        signatureSimple,
      ))
    ) {
      // Never log raw identity data. The SHA-256 digest is sufficient to
      // correlate a failing delivery with a Didit payload without retaining PII.
      console.warn(
        "DIDIT_WEBHOOK_SIGNATURE_REJECTED",
        JSON.stringify({
          timestamp: timestampHeader,
          raw_body_sha256: await sha256Hex(raw),
          body_bytes: new TextEncoder().encode(raw).byteLength,
        }),
      );
      return json({ ok: false, error: "INVALID_SIGNATURE" }, 401);
    }

    const webhookType = String(payload.webhook_type ?? "");
    if (!EVENT_TYPES.has(webhookType)) {
      return json({ ok: false, error: "UNSUPPORTED_WEBHOOK_TYPE" }, 400);
    }

    const eventId = String(payload.event_id ?? "");
    if (!eventId) {
      return json({ ok: false, error: "INVALID_EVENT" }, 400);
    }

    const rawBodyHash = await sha256Hex(raw);

    const task = recordAndProcess(payload, eventId, webhookType, rawBodyHash).catch(
      (error) => {
        console.error(
          "DIDIT_WEBHOOK_PROCESSING_FAILED",
          JSON.stringify({
            event_id: eventId,
            webhook_type: webhookType,
            raw_body_sha256: rawBodyHash,
            error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          }),
        );
      },
    );

    const edgeRuntime = (globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
    }).EdgeRuntime;

    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(task);
    } else {
      await task;
    }

    return json({ ok: true, accepted: true }, 202);
  } catch (error) {
    console.error(
      "DIDIT_WEBHOOK_FAILURE",
      JSON.stringify({
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      }),
    );
    return json({ ok: false, error: "WEBHOOK_PROCESSING_FAILED" }, 500);
  }
});
