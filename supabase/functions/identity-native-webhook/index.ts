import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const CALLBACK_SECRET = Deno.env.get("IDSWYFT_WEBHOOK_SECRET") ?? "";
const IDENTITY_SECRET = Deno.env.get("IDENTITY_PREAUTH_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = { "Access-Control-Allow-Origin": "https://testagram.site", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!SERVICE_KEY || !CALLBACK_SECRET || !IDENTITY_SECRET) return json({ ok: false, error: "WEBHOOK_NOT_CONFIGURED" }, 503);

  const raw = await req.text();
  const supplied = req.headers.get("X-Testagram-Identity-Signature") || "";
  const expected = "sha256=" + await hmacHex(CALLBACK_SECRET, raw);
  if (!safeEqual(supplied, expected)) return json({ ok: false, error: "INVALID_SIGNATURE" }, 401);

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  const intentId = String(body?.registration_intent_id || "");
  const verificationId = String(body?.verification_id || "");
  const status = String(body?.status || "");
  const eventId = req.headers.get("X-Idswyft-Webhook-Id") || verificationId + ":" + status;
  if (!/^[0-9a-f-]{36}$/i.test(intentId) || !verificationId || !["verified","failed","manual_review"].includes(status)) {
    return json({ ok: false, error: "INVALID_PAYLOAD" }, 400);
  }

  const { data: existingEvent } = await admin.from("identity_verification_events")
    .select("id").eq("provider_event_id", eventId).maybeSingle();
  if (existingEvent) return json({ ok: true, duplicate: true });

  const idNumber = String(body?.id_number || "").replace(/\D/g, "");
  const birthDate = String(body?.date_of_birth || "").trim();
  let idHmac: string | null = null;
  if (status === "verified") {
    if (!/^\d{6,12}$/.test(idNumber)) return json({ ok: false, error: "VERIFIED_ID_MISSING" }, 422);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return json({ ok: false, error: "VERIFIED_DOB_MISSING" }, 422);
    idHmac = await hmacHex(IDENTITY_SECRET, "id|" + idNumber);
  }

  const identityStatus = status === "verified" ? "approved" : status === "failed" ? "rejected" : "under_review";
  const last4 = idNumber ? idNumber.slice(-4) : null;
  const { error: updateError } = await admin.schema("private").from("identity_signup_intents").update({
    didit_status: status,
    identity_status: identityStatus,
    id_number_hmac: idHmac,
    id_number_last4: last4,
    verified_birth_date: status === "verified" ? birthDate : null,
    provider_reference: verificationId,
    rejection_reason: status === "failed" ? String(body?.rejection_reason || "IDSWYFT_VERIFICATION_FAILED").slice(0, 500) : null,
    updated_at: new Date().toISOString(),
  }).eq("id", intentId);
  if (updateError) throw updateError;

  const { error: eventError } = await admin.from("identity_verification_events").insert({
    user_id: null,
    event_type: "IDSWYFT_" + status.toUpperCase(),
    outcome: status,
    provider_event_id: eventId,
    metadata: {
      provider: "idswyft",
      session_id: verificationId,
      intent_id: intentId,
      id_last4: last4,
    },
  });
  if (eventError && eventError.code !== "23505") throw eventError;

  return json({ ok: true, status: identityStatus });
});
