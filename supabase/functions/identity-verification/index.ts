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

async function db(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc("identity_verification_db", {
    p_action: action,
    p_payload: payload,
  });
  if (error) throw new Error(error.message || "IDENTITY_DB_ERROR");
  return data as any;
}

async function getIntent(registrationToken: string) {
  return db("get_intent", {
    registration_token_hash: await hmacHex("registration|" + registrationToken),
  });
}

async function getSession(sessionToken: string) {
  return db("get_session", { token_hash: await tokenHash(sessionToken) });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "create_session") {
      const registrationToken = String(body?.registration_token || "").trim();
      if (!registrationToken) return json({ ok: false, error: "REGISTRATION_TOKEN_REQUIRED" }, 400);

      const intent = await getIntent(registrationToken);
      if (intent.identity_status === "approved") return json({ ok: true, already_approved: true });

      const existing = await db("find_active_session", { intent_id: intent.id });
      const rawToken = randomHex(32);
      const hash = await tokenHash(rawToken);

      if (existing?.id) {
        const rotated = await db("rotate_session_token", { session_id: existing.id, token_hash: hash });
        return json({ ok: true, session_id: rotated.id, session_token: rawToken, state: rotated.state, expires_at: rotated.expires_at });
      }

      const session = await db("create_session", {
        intent_id: intent.id,
        user_id: intent.completed_user_id || null,
        token_hash: hash,
      });
      return json({ ok: true, session_id: session.id, session_token: rawToken, state: session.state, expires_at: session.expires_at });
    }

    const sessionToken = String(body?.session_token || "").trim();
    if (!sessionToken) return json({ ok: false, error: "SESSION_TOKEN_REQUIRED" }, 400);
    const session = await getSession(sessionToken);

    if (action === "upload_urls") {
      const kinds = Array.isArray(body?.kinds) ? body.kinds : ["id_front", "id_back", "selfie", "liveness_video"];
      const allowed = new Set(["id_front", "id_back", "selfie", "liveness_video"]);
      const requested = Array.from(new Set(kinds.map((value: unknown) => String(value)))).filter((k) => allowed.has(String(k)));
      if (!requested.length) return json({ ok: false, error: "NO_VALID_EVIDENCE_KINDS" }, 400);

      const results: Array<Record<string, unknown>> = [];
      for (const kind of requested) {
        const suffix = randomHex(10);
        const isVideo = kind === "liveness_video";
        const path = session.id + "/" + kind + "-" + suffix + (isVideo ? ".webm" : ".jpg");
        const { data, error } = await admin.storage.from("identity-evidence").createSignedUploadUrl(path, { upsert: false });
        if (error) throw error;
        await db("add_evidence", {
          session_id: session.id,
          kind,
          object_path: path,
          mime_type: isVideo ? "video/webm" : "image/jpeg",
        });
        results.push({ kind, path, token: data?.token, url: data?.signedUrl || null });
      }
      return json({ ok: true, uploads: results });
    }

    if (action === "status") {
      const evidence = await db("list_evidence", { session_id: session.id });
      const result = await db("get_engine_result", { session_id: session.id });
      return json({ ok: true, state: session.state, evidence, engine_result: result === null ? null : result });
    }

    if (action === "mark_uploaded") {
      const kind = String(body?.kind || "");
      const objectPath = String(body?.path || "");
      if (!["id_front", "id_back", "selfie", "liveness_video"].includes(kind) || !objectPath.startsWith(session.id + "/")) {
        return json({ ok: false, error: "INVALID_EVIDENCE_REFERENCE" }, 400);
      }
      await db("mark_uploaded", { session_id: session.id, kind, object_path: objectPath });
      return json({ ok: true });
    }

    if (action === "begin_processing") {
      await db("begin_processing", { session_id: session.id, intent_id: session.intent_id });
      return json({ ok: true, state: "processing" });
    }

    if (action === "cancel") {
      await db("cancel", { session_id: session.id, intent_id: session.intent_id });
      return json({ ok: true });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("TESTAGRAM_IDENTITY_SESSION_FAILURE", message);
    return json({ ok: false, error: message }, 500);
  }
});
