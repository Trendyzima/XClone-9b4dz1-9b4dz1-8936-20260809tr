import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const IDSWYFT_BASE_URL = (Deno.env.get("IDSWYFT_BASE_URL") ?? "").replace(/\/$/, "");
const IDSWYFT_API_KEY = Deno.env.get("IDSWYFT_API_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "https://testagram.site",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

async function authenticate(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("AUTH_REQUIRED");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error("AUTH_REQUIRED");
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!SERVICE_KEY || !IDSWYFT_BASE_URL || !IDSWYFT_API_KEY) return json({ ok: false, error: "NATIVE_IDENTITY_NOT_CONFIGURED" }, 503);

  try {
    const user = await authenticate(req);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("identity_verification_status,birth_date")
      .eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.identity_verification_status === "approved") return json({ ok: true, already_approved: true });

    const { data: intent, error: intentError } = await admin.schema("private").from("identity_signup_intents")
      .select("id,email,identity_status,completed_user_id,expires_at")
      .eq("completed_user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    if (intentError) throw intentError;
    if (!intent?.id) return json({ ok: false, error: "IDENTITY_REGISTRATION_NOT_FOUND" }, 409);

    const response = await fetch(IDSWYFT_BASE_URL + "/api/v2/verify/initialize", {
      method: "POST",
      headers: { "X-API-Key": IDSWYFT_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: intent.id,
        document_type: "national_id",
        issuing_country: "KE",
        verification_mode: "identity",
        sandbox: false,
        source: "api",
      }),
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    if (!response.ok) return json({ ok: false, error: "IDSWYFT_INITIALIZE_FAILED", status: response.status }, 502);
    let session: any;
    try { session = JSON.parse(raw); } catch { return json({ ok: false, error: "IDSWYFT_INVALID_RESPONSE" }, 502); }
    if (!session?.verification_id || !session?.session_token || !session?.verification_url) return json({ ok: false, error: "IDSWYFT_RESPONSE_INCOMPLETE" }, 502);

    const { error: updateError } = await admin.schema("private").from("identity_signup_intents").update({
      didit_session_id: session.verification_id,
      didit_status: session.status ?? "AWAITING_FRONT",
      provider_reference: session.verification_id,
      identity_status: "pending",
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("id", intent.id);
    if (updateError) throw updateError;

    return json({
      ok: true,
      provider: "idswyft",
      verification_id: session.verification_id,
      session_token: session.session_token,
      verification_url: session.verification_url,
      verification_mode: session.verification_mode ?? "identity",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "AUTH_REQUIRED" ? 401 : 500;
    return json({ ok: false, error: message }, status);
  }
});
