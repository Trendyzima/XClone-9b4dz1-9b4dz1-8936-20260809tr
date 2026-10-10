import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SIGNING_SECRET = Deno.env.get("ZENAD_EVENT_SIGNING_SECRET") ?? SERVICE;
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const EVENTS = new Set(["click", "viewable", "video_start", "video_first_quartile", "video_midpoint", "video_third_quartile", "video_complete"]);

async function currentUser(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || !ANON) return null;
  try {
    const client = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
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


function clientAddress(req: Request) {
  return req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown-client";
}

async function consumeRateLimit(req: Request, scope: string, limit: number) {
  // HMAC the address so the database never stores raw IP addresses.
  const keyHash = await sign(`${scope}:${clientAddress(req)}`);
  const { data, error } = await admin.rpc("testagram_consume_ad_rate_limit", {
    p_key_hash: keyHash,
    p_window_seconds: 60,
    p_limit: limit,
  });
  if (error) throw error;
  return data === true;
}

async function isSystemOwner(userId: string | null) {
  if (!userId) return false;
  const { data, error } = await admin.from("testagram_governance_owner")
    .select("user_id")
    .eq("singleton", true)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.user_id);
}

async function adminAction(req: Request, body: any, userId: string | null) {
  if (!(await isSystemOwner(userId))) return json({ error: "Owner authorization required" }, 403);
  const action = String(body.action ?? "");

  if (action === "list") {
    const [campaigns, slots, creatives] = await Promise.all([
      admin.from("testagram_ad_campaigns").select("id,name,status,payment_status,priority,bid_cpm_micros,lifetime_budget_micros,funded_micros,targeting,starts_at,ends_at,created_at").order("created_at", { ascending: false }).limit(200),
      admin.from("testagram_ad_slots").select("id,code,kind,floor_cpm_micros,enabled,width,height").order("code"),
      admin.from("testagram_ad_creatives").select("id,campaign_id,headline,body,cta,click_through_url,enabled,format,asset_url,created_at").order("created_at", { ascending: false }).limit(500),
    ]);
    const error = campaigns.error ?? slots.error ?? creatives.error;
    if (error) throw error;
    return json({ ok: true, campaigns: campaigns.data ?? [], slots: slots.data ?? [], creatives: creatives.data ?? [] });
  }

  if (action === "toggle_campaign") {
    const campaignId = String(body.campaign_id ?? "");
    const nextStatus = String(body.status ?? "");
    if (!campaignId || !["active", "paused"].includes(nextStatus)) return json({ error: "Invalid campaign change" }, 400);
    const { data: campaign, error: lookupError } = await admin.from("testagram_ad_campaigns")
      .select("id,status,payment_status,lifetime_budget_micros,funded_micros,starts_at,ends_at")
      .eq("id", campaignId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!campaign) return json({ error: "Campaign not found" }, 404);
    if (nextStatus === "active") {
      const now = Date.now();
      if (campaign.payment_status !== "funded" || Number(campaign.funded_micros) < Number(campaign.lifetime_budget_micros)
          || new Date(campaign.starts_at).getTime() > now
          || (campaign.ends_at && new Date(campaign.ends_at).getTime() < now)) {
        return json({ error: "Only a fully funded campaign within its scheduled dates can be activated" }, 409);
      }
    }
    const { error } = await admin.from("testagram_ad_campaigns").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", campaignId);
    if (error) throw error;
    return json({ ok: true, status: nextStatus });
  }

  if (action === "toggle_slot") {
    const slotId = String(body.slot_id ?? "");
    if (!slotId || typeof body.enabled !== "boolean") return json({ error: "Invalid slot change" }, 400);
    const { data, error } = await admin.from("testagram_ad_slots").update({ enabled: body.enabled }).eq("id", slotId).select("id,enabled").maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Slot not found" }, 404);
    return json({ ok: true, slot: data });
  }

  return json({ error: "Unsupported admin action" }, 400);
}

async function serve(req: Request, body: any, userId: string | null) {
  // Ad delivery is intentionally public so signed-out visitors can receive ads.
  // Identity is always derived from the verified session, never from request JSON.
  const slotCode = String(body.slot_code ?? "feed-top").slice(0, 80);
  const requestId = String(body.request_id ?? crypto.randomUUID()).slice(0, 160);
  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/zenad-decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON,
      // The decision function keeps its gateway JWT check enabled. For an
      // anonymous visitor, use the project's publishable key only as gateway
      // credentials; the decision function still resolves no user identity.
      Authorization: userId ? (req.headers.get("Authorization") ?? `Bearer ${ANON}`) : `Bearer ${ANON}`,
    },
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
  // Signed event tokens authorize anonymous impressions as well as signed-in
  // impressions. The impression's stored user_id must exactly match the
  // verified caller identity (including null for anonymous traffic).
  const impressionId = String(body.impression_id ?? "").slice(0, 120);
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
  if (!SUPABASE_URL || !SERVICE || !ANON || !SIGNING_SECRET) return json({ error: "Ad service is not configured" }, 503);
  try {
    const body = await req.json().catch(() => ({}));
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    const scope = path.endsWith("/admin") ? "admin" : path.endsWith("/event") ? "event" : "serve";
    const limit = scope === "admin" ? 30 : scope === "event" ? 180 : 60;
    if (!(await consumeRateLimit(req, scope, limit))) return json({ error: "Ad request rate limit exceeded" }, 429);
    const user = await currentUser(req);
    if (path.endsWith("/admin")) return adminAction(req, body, user?.id ?? null);
    if (path.endsWith("/event")) return event(req, body, user?.id ?? null);
    return serve(req, body, user?.id ?? null);
  } catch (error) {
    console.error("testagram-ads", error);
    return json({ error: error instanceof Error ? error.message : "Ad service failed" }, 500);
  }
});
