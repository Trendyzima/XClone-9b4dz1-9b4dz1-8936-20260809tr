import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const WEBHOOK_SECRET = Deno.env.get("IDSWYFT_WEBHOOK_SECRET") ?? "";
const IDENTITY_SECRET = Deno.env.get("IDENTITY_PREAUTH_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function safeEqual(a: string, b: string) {
  const left = a.trim().toLowerCase().replace(/^sha256=/, "");
  const right = b.trim().toLowerCase().replace(/^sha256=/, "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("");
}

async function idHmac(id: string) {
  if (!IDENTITY_SECRET) throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");
  return "\\x" + await hmacHex("ke-nid|" + id, IDENTITY_SECRET);
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

function getOcr(data: any) {
  return data?.ocr_data ?? data?.document?.ocr_data ?? data?.front_document?.ocr_data ?? {};
}

function getId(data: any) {
  const ocr = getOcr(data);
  return normalizeId(ocr.id_number ?? ocr.document_number ?? ocr.personal_number ?? data?.id_number);
}

function getDob(data: any) {
  const ocr = getOcr(data);
  return normalizeDob(ocr.date_of_birth ?? ocr.birth_date ?? data?.date_of_birth);
}

function isAdult(dateString: string) {
  const dob = new Date(dateString + "T00:00:00Z");
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  return dob <= cutoff;
}

function providerPassed(data: any) {
  const live = data?.liveness_results ?? data?.liveness ?? {};
  const face = data?.face_match_results ?? data?.face_match ?? {};
  const liveness = live.liveness_passed ?? live.passed ?? data?.liveness_passed;
  const facePassed = face.passed ?? data?.face_match_passed;
  return liveness === true && facePassed === true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!SERVICE_KEY || !WEBHOOK_SECRET) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);

  const raw = await req.text();
  const signature = req.headers.get("X-Idswyft-Signature") || "";
  if (!signature || !safeEqual(await hmacHex(raw, WEBHOOK_SECRET), signature)) {
    return json({ ok: false, error: "INVALID_SIGNATURE" }, 401);
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  const verificationId = String(payload?.verification_id ?? "");
  const status = String(payload?.status ?? "");
  const eventId = req.headers.get("X-Idswyft-Webhook-Id") || `${verificationId}:${status}:${Date.now()}`;
  if (!verificationId) return json({ ok: false, error: "VERIFICATION_ID_REQUIRED" }, 400);

  const { data: intent, error: intentError } = await admin.schema("private")
    .from("identity_signup_intents")
    .select("*")
    .eq("didit_session_id", verificationId)
    .maybeSingle();
  if (intentError) throw intentError;

  // Persist an auditable provider event even if it cannot be mapped to a live signup.
  const baseEvent = {
    provider_event_id: eventId,
    event_type: "idswyft." + status.toLowerCase(),
    outcome: status || "unknown",
    request_id: eventId,
    user_id: intent?.completed_user_id ?? null,
    actor_id: null,
    metadata: {
      provider: "idswyft",
      verification_id: verificationId,
      user_id: payload?.user_id ?? null,
      status,
      timestamp: payload?.timestamp ?? null,
      data: payload?.data ?? null,
    },
  };
  const { error: eventError } = await admin.from("identity_verification_events").insert(baseEvent);
  if (eventError && eventError.code !== "23505") throw eventError;

  if (!intent) return json({ ok: true, ignored: true });

  let identityStatus = intent.identity_status;
  let rejectionReason: string | null = null;
  let fingerprint: string | null = null;
  let last4: string | null = null;
  let verifiedDob: string | null = null;

  if (status === "COMPLETE" || status === "verified" || status === "VERIFIED") {
    const id = getId(payload.data);
    const dob = getDob(payload.data);
    if (!id || !dob) {
      identityStatus = "rejected";
      rejectionReason = "IDENTITY_DATA_MISSING";
    } else if (dob !== intent.birth_date) {
      identityStatus = "rejected";
      rejectionReason = "BIRTH_DATE_MISMATCH";
    } else if (!isAdult(dob)) {
      identityStatus = "rejected";
      rejectionReason = "AGE_RESTRICTION";
    } else if (!providerPassed(payload.data)) {
      identityStatus = "rejected";
      rejectionReason = "LIVENESS_OR_FACE_MATCH_FAILED";
    } else {
      fingerprint = await idHmac(id);
      last4 = id.slice(-4);
      verifiedDob = dob;
      const { data: duplicate } = await admin.from("identity_verifications")
        .select("id,user_id").eq("id_number_hmac", fingerprint).maybeSingle();
      if (duplicate && duplicate.user_id !== intent.completed_user_id) {
        identityStatus = "blocked";
        rejectionReason = "IDENTITY_ALREADY_REGISTERED";
      } else {
        identityStatus = "approved";
      }
    }
  } else if (status === "HARD_REJECTED" || status === "failed" || status === "FAILED") {
    identityStatus = "rejected";
    rejectionReason = String(payload?.data?.rejection_reason ?? payload?.data?.failure_reason ?? "IDENTITY_PROVIDER_REJECTED");
  } else if (status === "manual_review" || status === "MANUAL_REVIEW") {
    identityStatus = "under_review";
    rejectionReason = "IDENTITY_PROVIDER_MANUAL_REVIEW";
  } else {
    identityStatus = "pending";
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    didit_status: status,
    identity_status: identityStatus,
    provider_reference: verificationId,
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

  const { error: updateError } = await admin.schema("private")
    .from("identity_signup_intents").update(updatePayload).eq("id", intent.id);
  if (updateError) throw updateError;

  if (identityStatus === "approved" && intent.completed_user_id && fingerprint) {
    const { error: identityError } = await admin.from("identity_verifications").upsert({
      user_id: intent.completed_user_id,
      id_type: "ke_national_id",
      id_number_hmac: fingerprint,
      id_number_last4: last4,
      country_code: "KE",
      status: "approved",
      verification_method: "self_hosted",
      provider: "idswyft",
      provider_reference: verificationId,
      submitted_at: now,
      reviewed_at: now,
      email_snapshot: intent.email,
    }, { onConflict: "user_id" });

    if (identityError) {
      if (identityError.code === "23505") {
        await admin.schema("private").from("identity_signup_intents").update({
          identity_status: "blocked",
          rejection_reason: "IDENTITY_ALREADY_REGISTERED",
          updated_at: now,
        }).eq("id", intent.id);
      } else {
        throw identityError;
      }
    } else {
      const { error: profileError } = await admin.from("profiles").update({
        identity_verification_status: "approved",
        identity_verified_at: now,
      }).eq("id", intent.completed_user_id);
      if (profileError) throw profileError;
    }
  }

  return json({ ok: true, status: identityStatus });
});
