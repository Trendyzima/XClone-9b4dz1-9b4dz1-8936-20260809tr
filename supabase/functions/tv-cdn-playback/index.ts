import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const encoder = new TextEncoder();

function hex(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

function publicHttps(url: URL) {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST required" }), { status: 405, headers: cors });
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ ok: false, error: "Authentication required" }), { status: 401, headers: cors });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ ok: false, error: "Authentication required" }), { status: 401, headers: cors });
  }

  const secret = Deno.env.get("TESTAGRAM_CDN_PLAYBACK_SECRET") || "";
  const cdnBase = "https://media.testagram.site";
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "CDN playback signing is not configured" }), { status: 503, headers: cors });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON body required" }), { status: 400, headers: cors });
  }

  const streamId = String(body?.stream_id || "").trim();
  const sourceUrl = String(body?.source_url || "").trim();
  if (!streamId || streamId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(streamId)) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid stream_id" }), { status: 400, headers: cors });
  }

  let source: URL;
  try { source = new URL(sourceUrl); } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid source_url" }), { status: 400, headers: cors });
  }
  const allowedHosts = (Deno.env.get("TESTAGRAM_TV_ALLOWED_HOSTS") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!publicHttps(source)) {
    return new Response(JSON.stringify({ ok: false, error: "Source must be a public HTTPS URL" }), { status: 400, headers: cors });
  }
  if (allowedHosts.length > 0 && !allowedHosts.includes(source.hostname.toLowerCase())) {
    return new Response(JSON.stringify({ ok: false, error: "Stream source is not on the Testagram allow-list" }), { status: 403, headers: cors });
  }

  const exp = Math.floor(Date.now() / 1000) + 600;
  const payload = exp + "|" + streamId + "|" + source.toString();
  const signature = await sign(secret, payload);
  const token = exp + "." + streamId + "." + signature;
  const playback = new URL(cdnBase + "/v1/tv/" + encodeURIComponent(streamId) + "/index.m3u8");
  playback.searchParams.set("src", source.toString());
  playback.searchParams.set("token", token);

  return new Response(JSON.stringify({
    ok: true,
    data: {
      playback_url: playback.toString(),
      expires_at: new Date(exp * 1000).toISOString(),
      user_id: user.id,
    },
    error: null,
  }), { status: 200, headers: cors });
});
