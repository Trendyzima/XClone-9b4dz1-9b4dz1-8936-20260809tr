import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const mediaUrl = Deno.env.get("MEDIA_ENGINE_URL") ?? "";
const mediaSecret = Deno.env.get("MEDIA_ENGINE_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin, Access-Control-Request-Headers",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
});

const enc = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const signMediaToken = async (payload: Record<string, unknown>) => {
  const header = enc("testagram-media-v1");
  const body = enc(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(mediaSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return header + "." + body + "." + enc(signature);
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST required" } }, 405);

  if (!supabaseUrl || !supabaseKey || !mediaUrl || !mediaSecret) {
    return json({
      ok: false,
      error: {
        code: "MEDIA_ENGINE_NOT_CONFIGURED",
        message: "Testagram Media Engine is not configured",
        details: {
          missing: [
            !mediaUrl ? "MEDIA_ENGINE_URL" : null,
            !mediaSecret ? "MEDIA_ENGINE_SECRET" : null,
          ].filter(Boolean),
        },
      },
    }, 503);
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ ok: false, error: { code: "AUTH_REQUIRED", message: "Sign in to use Testagram Live." } }, 401);
  }

  const db = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData.user) {
    return json({ ok: false, error: { code: "AUTH_REQUIRED", message: "Your Testagram session is invalid." } }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "JSON required" } }, 400);
  }

  const streamId = typeof body.stream_id === "string" ? body.stream_id : "";
  const role = body.role === "host" || body.role === "guest" ? body.role : "viewer";
  if (!streamId) return json({ ok: false, error: { code: "STREAM_ID_REQUIRED", message: "stream_id is required" } }, 400);

  const { data: stream, error: streamError } = await db
    .from("live_streams")
    .select("id,user_id,is_live,title")
    .eq("id", streamId)
    .maybeSingle();

  if (streamError || !stream) return json({ ok: false, error: { code: "STREAM_NOT_FOUND", message: "TV broadcast was not found." } }, 404);
  if (role === "host" && stream.user_id !== authData.user.id) return json({ ok: false, error: { code: "HOST_REQUIRED", message: "Only the broadcaster can publish." } }, 403);
  if (!stream.is_live && role !== "host") return json({ ok: false, error: { code: "STREAM_ENDED", message: "Broadcast is no longer live." } }, 409);

  if (role === "guest") {
    const invite = typeof body.invite_token === "string" ? body.invite_token : "";
    if (!invite) return json({ ok: false, error: { code: "INVITE_REQUIRED", message: "A TV guest invitation is required." } }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signMediaToken({
    role,
    stream_id: stream.id,
    user_id: authData.user.id,
    exp: now + 3600,
  });

  return json({
    ok: true,
    data: {
      token,
      ws_url: mediaUrl.replace(/\/$/, "") + "/ws",
      stream_id: stream.id,
      role,
    },
    error: null,
  });
});
