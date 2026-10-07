import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const IDENTITY_SECRET = Deno.env.get("IDENTITY_PREAUTH_SECRET") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "https://testagram.site",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function randomHex(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(value: string) {
  if (!IDENTITY_SECRET) throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(IDENTITY_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("");
}
async function tokenHash(token: string) {
  return hmacHex("session|" + token);
}
async function getIntent(registrationToken: string) {
  const hash = await hmacHex("registration|" + registrationToken);
  const { data, error } = await admin.schema("private").from("identity_signup_intents")
    .select("*").eq("registration_token_hash", hash).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("REGISTRATION_NOT_FOUND");
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) throw new Error("REGISTRATION_EXPIRED");
  if (!data.email_verified_at) throw new Error("EMAIL_NOT_VERIFIED");
  return data;
}
async function getSession(sessionToken: string) {
  const hash = await tokenHash(sessionToken);
  const { data, error } = await admin.schema("private").from("identity_verification_sessions")
    .select("*").eq("token_hash", hash).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("VERIFICATION_SESSION_NOT_FOUND");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error("VERIFICATION_SESSION_EXPIRED");
  if (["approved","rejected","cancelled","expired"].includes(data.state)) throw new Error("VERIFICATION_SESSION_TERMINAL");
  return data;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok:false, error:"METHOD_NOT_ALLOWED" }, 405);
  if (!SERVICE_KEY) return json({ ok:false, error:"SERVER_NOT_CONFIGURED" }, 503);
  try {
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "create_session") {
      const registrationToken = String(body?.registration_token || "").trim();
      if (!registrationToken) return json({ok:false,error:"REGISTRATION_TOKEN_REQUIRED"},400);
      const intent = await getIntent(registrationToken);
      if (intent.identity_status === "approved") return json({ok:true,already_approved:true});
      const existing = await admin.schema("private").from("identity_verification_sessions")
        .select("id,state,expires_at").eq("intent_id", intent.id).in("state",["created","capturing","processing","under_review"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if (existing.data) {
        const rawToken = randomHex(32);
        const hash = await tokenHash(rawToken);
        await admin.schema("private").from("identity_verification_sessions").update({token_hash:hash,updated_at:new Date().toISOString()}).eq("id",existing.data.id);
        return json({ok:true,session_id:existing.data.id,session_token:rawToken,state:existing.data.state,expires_at:existing.data.expires_at});
      }
      const rawToken = randomHex(32);
      const hash = await tokenHash(rawToken);
      const expires = new Date(Date.now()+30*60*1000).toISOString();
      const {data:session,error} = await admin.schema("private").from("identity_verification_sessions").insert({
        intent_id:intent.id,user_id:intent.completed_user_id || null,token_hash:hash,state:"created",expires_at:expires,started_at:new Date().toISOString(),updated_at:new Date().toISOString()
      }).select("id,state,expires_at").single();
      if (error) throw error;
      await admin.schema("private").from("identity_signup_intents").update({verification_session_id:session.id,verification_stage:"capture",identity_status:"pending",updated_at:new Date().toISOString()}).eq("id",intent.id);
      return json({ok:true,session_id:session.id,session_token:rawToken,state:session.state,expires_at:session.expires_at});
    }

    const sessionToken = String(body?.session_token || "").trim();
    if (!sessionToken) return json({ok:false,error:"SESSION_TOKEN_REQUIRED"},400);
    const session = await getSession(sessionToken);

    if (action === "upload_urls") {
      const kinds = Array.isArray(body?.kinds) ? body.kinds : ["id_front","id_back","selfie","liveness_video"];
      const allowed = new Set(["id_front","id_back","selfie","liveness_video"]);
      const requested = [...new Set(kinds.map(String))].filter(k => allowed.has(k));
      if (!requested.length) return json({ok:false,error:"NO_VALID_EVIDENCE_KINDS"},400);
      const results:any[] = [];
      for (const kind of requested) {
        const suffix = randomHex(10);
        const ext = kind === "liveness_video" ? "webm" : "jpg";
        const path = session.id + "/" + kind + "-" + suffix + "." + ext;
        const {data,error} = await admin.storage.from("identity-evidence").createSignedUploadUrl(path,{upsert:false});
        if (error) throw error;
        const mime = kind === "liveness_video" ? "video/webm" : "image/jpeg";
        const {error:manifestError} = await admin.schema("private").from("identity_verification_evidence").insert({
          session_id:session.id,kind,object_path:path,mime_type:mime,state:"uploaded"
        });
        if (manifestError) throw manifestError;
        results.push({kind,path,token:data?.token,url:data?.signedUrl || data?.signedURL || null});
      }
      await admin.schema("private").from("identity_verification_sessions").update({state:"capturing",updated_at:new Date().toISOString()}).eq("id",session.id);
      return json({ok:true,uploads:results});
    }

    if (action === "status") {
      const {data:evidence} = await admin.schema("private").from("identity_verification_evidence").select("kind,state,created_at").eq("session_id",session.id).order("created_at",{ascending:true});
      const {data:result} = await admin.schema("private").from("identity_engine_results").select("model_version,decision,rejection_reason,created_at").eq("session_id",session.id).maybeSingle();
      return json({ok:true,state:session.state,evidence:evidence||[],engine_result:result||null});
    }

    if (action === "begin_processing") {
      const {data:evidence,error} = await admin.schema("private").from("identity_verification_evidence").select("kind,state").eq("session_id",session.id);
      if (error) throw error;
      const kinds = new Set((evidence||[]).map((e:any)=>e.kind));
      for (const required of ["id_front","id_back","selfie","liveness_video"]) if (!kinds.has(required)) return json({ok:false,error:"MISSING_"+required.toUpperCase()},400);
      await admin.schema("private").from("identity_verification_sessions").update({state:"processing",updated_at:new Date().toISOString()}).eq("id",session.id);
      await admin.schema("private").from("identity_signup_intents").update({verification_stage:"processing",identity_status:"pending",updated_at:new Date().toISOString()}).eq("id",session.intent_id);
      return json({ok:true,state:"processing"});
    }

    if (action === "cancel") {
      await admin.schema("private").from("identity_verification_sessions").update({state:"cancelled",completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",session.id);
      await admin.schema("private").from("identity_signup_intents").update({verification_stage:"cancelled",identity_status:"rejected",rejection_reason:"USER_CANCELLED",updated_at:new Date().toISOString()}).eq("id",session.intent_id);
      return json({ok:true});
    }

    return json({ok:false,error:"UNKNOWN_ACTION"},400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("TESTAGRAM_IDENTITY_SESSION_FAILURE", message);
    return json({ok:false,error:message},500);
  }
});
