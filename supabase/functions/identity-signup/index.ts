import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const IDENTITY_SECRET = Deno.env.get("IDENTITY_PREAUTH_SECRET") ?? "";
const FROM = "Testagram <noreply@testagram.site>";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "https://testagram.site",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("INVALID_EMAIL");
  return email;
}
function normalizeId(value: unknown) {
  const id = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{6,12}$/.test(id)) throw new Error("INVALID_NATIONAL_ID");
  return id;
}
function validDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_BIRTH_DATE");
  const parsed = new Date(date + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_BIRTH_DATE");
  return date;
}
function isAdult(dateString: string) {
  const dob = new Date(dateString + "T00:00:00Z");
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  return dob <= cutoff;
}
function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}
function randomOtp() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
}
async function hmacHex(value: string) {
  if (!IDENTITY_SECRET) throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(IDENTITY_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function tokenHash(token: string) {
  return sha256("testagram:identity-registration:" + token);
}
async function otpHash(email: string, code: string) {
  return hmacHex("otp|" + email + "|" + code);
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
async function sendOtp(email: string, code: string) {
  if (!RESEND_KEY) throw new Error("RESEND_NOT_CONFIGURED");
  const safeEmail = escapeHtml(email);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Arial,sans-serif;color:#172026">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,.07)">
  <div style="text-align:center"><img src="https://testagram.site/app-icon.jpg" width="64" height="64" style="border-radius:16px" alt="Testagram"><h1>Confirm your Testagram email</h1></div>
  <p>Hello,</p><p>Use the verification code below to continue creating your Testagram account.</p>
  <div style="margin:26px 0;padding:20px;text-align:center;background:#f5f6f7;border-radius:14px;font-size:32px;font-weight:800;letter-spacing:8px">${escapeHtml(code)}</div>
  <p style="font-size:13px;color:#667085">This code expires in 10 minutes. Testagram will not create your account until identity verification is approved.</p>
  <p style="font-size:12px;color:#98a2b3">Sent to ${safeEmail}</p></div></body></html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], subject: "Confirm your Testagram email", html, text: `Testagram verification code: ${code}. It expires in 10 minutes.` }),
  });
  if (!res.ok) throw new Error("RESEND_HTTP_" + res.status);
}
async function getIntent(token: string, allowCompletedUser = false) {
  const hash = await tokenHash(token);
  const { data, error } = await admin.schema("private").from("identity_signup_intents").select("*").eq("registration_token_hash", hash).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("REGISTRATION_NOT_FOUND");
  if (data.completed_user_id && !allowCompletedUser) throw new Error("REGISTRATION_COMPLETED");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error("REGISTRATION_EXPIRED");
  return data;
}
async function createIdentitySession(intent: any) {
  if (!IDENTITY_SECRET) throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");
  const rawToken = randomToken();
  const tokenHashValue = await hmacHex("session|" + rawToken);
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: session, error } = await admin.schema("private").from("identity_verification_sessions").insert({
    intent_id: intent.id,
    user_id: intent.completed_user_id || null,
    token_hash: tokenHashValue,
    state: "created",
    expires_at: expires,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("id,state,expires_at").single();
  if (error) throw error;
  const { error: intentError } = await admin.schema("private").from("identity_signup_intents").update({
    verification_session_id: session.id,
    verification_stage: "capture",
    identity_status: "pending",
    updated_at: new Date().toISOString(),
  }).eq("id", intent.id);
  if (intentError) throw intentError;
  return {
    session_id: session.id,
    session_token: rawToken,
    url: "https://testagram.site/verify-identity?session=" + encodeURIComponent(session.id),
    verification_id: session.id,
  };
}
function errorDetails(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return { message: String(value.message ?? value.error_description ?? value.code ?? "UNKNOWN_ERROR"), code: value.code, details: value.details, hint: value.hint };
  }
  return { message: String(error ?? "UNKNOWN_ERROR") };
}
async function finalizeAccount(intent: any, password: string) {
  if (!intent.email_verified_at) throw new Error("EMAIL_NOT_VERIFIED");
  if (intent.identity_status !== "approved") throw new Error("IDENTITY_NOT_APPROVED");
  if (!intent.verification_session_id) throw new Error("VERIFICATION_SESSION_MISSING");
  const { data: engineResult, error: engineResultError } = await admin.schema("private").from("identity_engine_results")
    .select("decision,verified_birth_date,id_number_hmac").eq("session_id", intent.verification_session_id).maybeSingle();
  if (engineResultError) throw engineResultError;
  if (!engineResult || engineResult.decision !== "approved") throw new Error("IDENTITY_ENGINE_APPROVAL_REQUIRED");
  if (!intent.id_number_hmac) throw new Error("IDENTITY_FINGERPRINT_MISSING");
  if (!intent.verified_birth_date || !isAdult(intent.verified_birth_date)) throw new Error("AGE_RESTRICTION");
  if (intent.birth_date !== intent.verified_birth_date) throw new Error("BIRTH_DATE_MISMATCH");
  if (password.length < 8) throw new Error("PASSWORD_TOO_SHORT");

  const created = await admin.auth.admin.createUser({
    email: intent.email,
    password,
    email_confirm: true,
    user_metadata: { username: intent.username || undefined, full_name: intent.display_name || undefined },
    app_metadata: { testagram_identity_verified: true },
  });
  if (created.error || !created.data?.user) {
    const message = created.error?.message || "ACCOUNT_CREATION_FAILED";
    if (/already registered|already exists/i.test(message)) throw new Error("EMAIL_ALREADY_REGISTERED");
    throw new Error(message);
  }
  const user = created.data.user;
  try {
    const now = new Date().toISOString();
    const { error: identityError } = await admin.from("identity_verifications").insert({
      user_id: user.id,
      id_type: "ke_national_id",
      id_number_hmac: intent.id_number_hmac,
      id_number_last4: intent.id_number_last4,
      country_code: "KE",
      status: "approved",
      verification_method: "self_hosted",
      provider: null,
      provider_reference: null,
      submitted_at: now,
      reviewed_at: now,
      email_snapshot: intent.email,
    });
    if (identityError) {
      if (identityError.code === "23505" && /id_number_hmac/i.test(identityError.message || "")) throw new Error("IDENTITY_ALREADY_REGISTERED");
      throw identityError;
    }
    const { error: profileError } = await admin.from("profiles").update({
      birth_date: intent.verified_birth_date,
      legal_terms_accepted_at: intent.legal_terms_accepted_at,
      legal_privacy_accepted_at: intent.legal_privacy_accepted_at,
      legal_content_policy_accepted_at: intent.legal_content_policy_accepted_at,
      legal_age_confirmed_at: intent.legal_age_confirmed_at,
      legal_policy_version: intent.legal_policy_version,
      identity_verification_status: "approved",
      identity_verified_at: now,
    }).eq("id", user.id);
    if (profileError) throw profileError;
    const { error: auditLinkError } = await admin.from("identity_verification_events")
      .update({ user_id: user.id })
      .is("user_id", null)
      .filter("metadata->>session_id", "eq", String(intent.verification_session_id));
    if (auditLinkError) throw auditLinkError;
    await admin.schema("private").from("identity_signup_intents").update({ completed_user_id: user.id, updated_at: now }).eq("id", intent.id);
    
    return user;
  } catch (error) {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok:false, error:"METHOD_NOT_ALLOWED" },405);
  if (!SERVICE_KEY) return json({ ok:false, error:"SERVER_NOT_CONFIGURED" },503);
  try {
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "start") {
      const email = normalizeEmail(body.email);
      const birthDate = validDate(body.birth_date);
      if (!isAdult(birthDate)) return json({ ok:false,error:"AGE_RESTRICTION" },403);
      if (body.legal_accepted !== true) return json({ ok:false,error:"LEGAL_ACCEPTANCE_REQUIRED" },400);
      const username = typeof body.username === "string" ? body.username.trim().slice(0,24) : null;
      const displayName = typeof body.display_name === "string" ? body.display_name.trim().slice(0,80) : null;
      const registrationToken = randomToken();
      const code = randomOtp();
      const now = new Date();
      const expires = new Date(now.getTime() + 30*60*1000).toISOString();
      const otpExpires = new Date(now.getTime() + 10*60*1000).toISOString();
      const registrationHash = await tokenHash(registrationToken);
      const codeHash = await otpHash(email, code);
      const { data: existing } = await admin.schema("private").from("identity_signup_intents").select("id").ilike("email", email).order("updated_at",{ascending:false}).limit(1).maybeSingle();
      const record = {
        email, email_otp_hash: codeHash, email_otp_expires_at: otpExpires, email_verified_at: null,
        registration_token_hash: registrationHash, legal_terms_accepted_at: now.toISOString(),
        legal_privacy_accepted_at: now.toISOString(), legal_content_policy_accepted_at: now.toISOString(),
        legal_age_confirmed_at: now.toISOString(), legal_policy_version: String(body.legal_policy_version || "2026-09"),
        birth_date: birthDate, username, display_name: displayName, verification_session_id: null,
        verification_stage: "not_started", identity_status: "pending", id_number_hmac: null, id_number_last4: null, email_otp_attempts: 0, email_otp_locked_until: null, email_otp_last_sent_at: now.toISOString(),
        country_code: "KE", provider_reference: null, rejection_reason: null, updated_at: now.toISOString(),
        expires_at: expires, completed_user_id: null,
      };
      let error: any = null;
      if (existing?.id) {
        ({ error } = await admin.schema("private").from("identity_signup_intents").update(record).eq("id", existing.id));
      } else {
        ({ error } = await admin.schema("private").from("identity_signup_intents").insert(record));
      }
      if (error) throw error;
      await sendOtp(email, code);
      return json({ ok:true, registration_token:registrationToken, email, next:"email_verification" });
    }

    if (action === "start_existing") {
      const authHeader = req.headers.get("Authorization") || "";
      const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!accessToken) return json({ok:false,error:"AUTH_REQUIRED"},401);
      const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
      if (authError || !authData.user) return json({ok:false,error:"AUTH_REQUIRED"},401);
      const existingUser = authData.user;
      const { data: profile, error: profileError } = await admin.from("profiles").select("birth_date,username,display_name,legal_terms_accepted_at,legal_privacy_accepted_at,legal_content_policy_accepted_at,legal_age_confirmed_at,legal_policy_version,identity_verification_status").eq("id", existingUser.id).maybeSingle();
      if (profileError) throw profileError;
      if (profile?.identity_verification_status === "approved") return json({ok:true,already_approved:true});
      if (!profile?.birth_date || !isAdult(String(profile.birth_date))) return json({ok:false,error:"AGE_RESTRICTION"},403);
      const now = new Date().toISOString();
      const email = normalizeEmail(existingUser.email || "");
      const registrationToken = randomToken();
      const registrationHash = await tokenHash(registrationToken);
      const { data: prior } = await admin.schema("private").from("identity_signup_intents").select("id").eq("completed_user_id", existingUser.id).order("updated_at",{ascending:false}).limit(1).maybeSingle();
      const record:any = {
        email, email_verified_at: now, email_otp_hash:null, email_otp_expires_at:null,
        registration_token_hash: registrationHash,
        legal_terms_accepted_at: profile.legal_terms_accepted_at || now,
        legal_privacy_accepted_at: profile.legal_privacy_accepted_at || now,
        legal_content_policy_accepted_at: profile.legal_content_policy_accepted_at || now,
        legal_age_confirmed_at: profile.legal_age_confirmed_at || now,
        legal_policy_version: profile.legal_policy_version || "2026-09",
        birth_date: String(profile.birth_date), username: profile.username || null, display_name: profile.display_name || null,
        verification_session_id:null,verification_stage:"capture",identity_status:"pending",id_number_hmac:null,id_number_last4:null,
        country_code:"KE",provider_reference:null,rejection_reason:null,updated_at:now,expires_at:new Date(Date.now()+30*60*1000).toISOString(),
        completed_user_id:existingUser.id,
      };
      let error:any=null;
      if(prior?.id) ({error}=await admin.schema("private").from("identity_signup_intents").update(record).eq("id",prior.id));
      else ({error}=await admin.schema("private").from("identity_signup_intents").insert(record));
      if(error) throw error;
      const {data:intent,error:intentError}=await admin.schema("private").from("identity_signup_intents").select("*").eq("registration_token_hash",registrationHash).single();
      if(intentError||!intent) throw intentError||new Error("REGISTRATION_NOT_FOUND");
      const session=await createIdentitySession(intent);
      return json({ok:true,registration_token:registrationToken,...session});
    }

    const token = String(body.registration_token || "").trim();
    if (!token) return json({ ok:false,error:"REGISTRATION_TOKEN_REQUIRED" },400);
    const intent = await getIntent(token, action === "status");

    if (action === "verify_email") {
      const code = String(body.code || "").replace(/\s+/g,"");
      if (!/^\d{6}$/.test(code)) return json({ok:false,error:"INVALID_CODE"},400);
      const supplied = await otpHash(intent.email, code);
      const {data:result,error} = await admin.schema("private").rpc("verify_identity_email_otp", {
        p_intent_id: intent.id,
        p_code_hash: supplied,
      });
      if (error) throw error;
      if (result === "VERIFIED" || result === "ALREADY_VERIFIED") return json({ok:true,next:"identity_verification"});
      if (result === "EXPIRED") return json({ok:false,error:"CODE_EXPIRED"},400);
      if (result === "LOCKED") return json({ok:false,error:"CODE_LOCKED"},429);
      return json({ok:false,error:"INVALID_CODE"},400);
    }

    if (action === "resend_email") {
      if (intent.email_verified_at) return json({ok:true,already_verified:true});
      if (intent.email_otp_locked_until && new Date(intent.email_otp_locked_until).getTime() > Date.now()) {
        return json({ok:false,error:"CODE_LOCKED"},429);
      }
      if (intent.email_otp_last_sent_at && Date.now() - new Date(intent.email_otp_last_sent_at).getTime() < 60_000) {
        return json({ok:false,error:"RESEND_TOO_SOON"},429);
      }
      const code = randomOtp();
      const now = new Date();
      const codeHash = await otpHash(intent.email, code);
      const { error } = await admin.schema("private").from("identity_signup_intents").update({
        email_otp_hash: codeHash,
        email_otp_expires_at: new Date(now.getTime()+10*60*1000).toISOString(),
        email_otp_attempts: 0,
        email_otp_locked_until: null,
        email_otp_last_sent_at: now.toISOString(),
        updated_at: now.toISOString()
      }).eq("id", intent.id);
      if (error) throw error;
      await sendOtp(intent.email, code);
      return json({ok:true});
    }

    if (action === "create_identity_session") {
      if (!intent.email_verified_at) throw new Error("EMAIL_NOT_VERIFIED");
      if (intent.identity_status === "approved") return json({ok:true,already_approved:true});
      const session = await createIdentitySession(intent);
      return json({ok:true,...session});
    }

    if (action === "status") {
      return json({ok:true,status:intent.identity_status,verification_stage:intent.verification_stage,email_verified:!!intent.email_verified_at,rejection_reason:intent.rejection_reason});
    }

    if (action === "finalize") {
      const user = await finalizeAccount(intent, String(body.password || ""));
      return json({ok:true,user_id:user.id,email:user.email});
    }

    return json({ok:false,error:"UNKNOWN_ACTION"},400);
  } catch (error) {
    const details = errorDetails(error);
    const message = details.message;
    const status = /RESTRICTION|NOT_APPROVED|NOT_VERIFIED|EXPIRED|REQUIRED|NOT_CONFIGURED|TIMEOUT/.test(message) ? 400 : 500;
    console.error("IDENTITY_SIGNUP_FAILURE", JSON.stringify({ error: details }));
    return json({ok:false,error:message},status);
  }
});
