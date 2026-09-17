import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SIGNING_SECRET = Deno.env.get("ZENAD_EVENT_SIGNING_SECRET") ?? SERVICE;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const EVENTS = new Set(["click", "viewable", "video_start", "video_first_quartile", "video_midpoint", "video_third_quartile", "video_complete"]);

async function currentUser(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || !ANON) return null;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(token);
  return data.user ?? null;
}

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromB64url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function verifyEventToken(token: string, impressionId: string) {
  try {
    const [payload, provided] = token.split(".");
    if (!payload || !provided) return false;
    const expected = await sign(payload);
    const a = fromB64url(provided);
    const b = fromB64url(expected);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) return false;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return data?.i === impressionId && Number(data?.e) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function serve(req: Request, body: any, userId: string | null) {
  if (!userId) return json({ error: "Authentication required" }, 401);
  const slotCode = String(body.slot_code ?? "feed-top");
  const requestId = String(body.request_id ?? crypto.randomUUID());
  const upstream = await fetch(`${URL}/functions/v1/zenad-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(req.headers.get("Authorization") ? { Authorization: req.headers.get("Authorization")! } : {}) },
    body: JSON.stringify({
      slotCode,
      id: requestId,
      content: body.context ?? {},
      user: { id: userId, device: body.device ?? null },
      privacy: body.privacy ?? {},
    }),
  });
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json({ error: "Ad serving failed" }, 502);
  if (result.kind !== "display") return json({ ok: false, request_id: requestId, reason: result.reason ?? "no_fill" });
  return json({
    ok: true,
    request_id: requestId,
    impression_id: result.impressionId,
    campaign_id: result.campaignId,
    creative_id: result.creativeId,
    format: result.format,
    headline: result.headline,
    body: result.body,
    cta: result.cta,
    asset_url: result.imageUrl,
    click_through_url: result.clickThroughUrl,
    slot_code: slotCode,
    event_token: result.eventToken,
    owner: "testagram",
    served_by: "zenad",
  });
}

async function event(req: Request, body: any, userId: string | null) {
  if (!userId) return json({ error: "Authentication required" }, 401);
  const impressionId = String(body.impression_id ?? "");
  const eventType = String(body.event_type ?? "");
  const eventToken = String(body.event_token ?? "");
  if (!impressionId || !eventType || !EVENTS.has(eventType)) return json({ error: "Invalid ad event" }, 400);
  if (!eventToken || !(await verifyEventToken(eventToken, impressionId))) return json({ error: "Invalid or expired event token" }, 401);
  const { data: impression, error: lookupError } = await admin
    .from("testagram_ad_impressions")
    .select("user_id")
    .eq("impression_id", impressionId)
    .maybeSingle();
  if (lookupError) return json({ error: "Ad event lookup failed" }, 500);
  if (!impression) return json({ error: "Unknown impression" }, 404);
  if (impression.user_id !== userId) return json({ error: "Not authorized for this impression" }, 403);
  const { data: ok, error } = await admin.rpc("testagram_record_ad_event", {
    p_impression_id: impressionId,
    p_event_type: eventType,
    p_metadata: body.metadata ?? {},
  });
  if (error) return json({ error: "Ad event recording failed" }, 500);
  return json({ ok: ok === true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!URL || !SERVICE || !ANON || !SIGNING_SECRET) return json({ error: "Ad service is not configured" }, 503);
  try {
    const body = await req.json().catch(() => ({}));
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    const user = await currentUser(req);
    if (path.endsWith("/event")) return event(req, body, user?.id ?? null);
    return serve(req, body, user?.id ?? null);
  } catch (error) {
    console.error("testagram-ads", error);
    return json({ error: error instanceof Error ? error.message : "Ad service failed" }, 500);
  }
});
