import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function currentUser(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || !ANON) return null;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(token);
  return data.user ?? null;
}

async function serve(req: Request, body: any, userId: string | null) {
  const slotCode = String(body.slot_code ?? "feed-top");
  const requestId = String(body.request_id ?? crypto.randomUUID());
  const upstream = await fetch(`${URL}/functions/v1/zenad-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(req.headers.get("Authorization") ? { Authorization: req.headers.get("Authorization")! } : {}) },
    body: JSON.stringify({
      slotCode,
      id: requestId,
      content: body.context ?? {},
      user: { id: userId ?? undefined, device: body.device ?? null },
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
  const impressionId = String(body.impression_id ?? "");
  const eventType = String(body.event_type ?? "");
  if (!impressionId || !eventType) return json({ error: "impression_id and event_type are required" }, 400);
  const { data: impression, error: lookupError } = await admin
    .from("testagram_ad_impressions")
    .select("user_id")
    .eq("impression_id", impressionId)
    .maybeSingle();
  if (lookupError) return json({ error: "Ad event lookup failed" }, 500);
  if (!impression) return json({ error: "Unknown impression" }, 404);
  if (impression.user_id && impression.user_id !== userId) return json({ error: "Not authorized for this impression" }, 403);
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
  if (!URL || !SERVICE || !ANON) return json({ error: "Ad service is not configured" }, 503);
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
