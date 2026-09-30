import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const signingSecret = Deno.env.get("MUX_WEBHOOK_SIGNING_SECRET") ?? "";
const toleranceSeconds = 300;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verified(rawBody: string, signature: string | null) {
  if (!signingSecret || !signature) return false;
  const parts = signature.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2) ?? "";
  const signatures = parts.filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds || !signatures.length) return false;
  const expected = await hmacSha256(signingSecret, timestamp + "." + rawBody);
  return signatures.some(candidate => constantTimeEqual(candidate, expected));
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!supabaseUrl || !serviceKey || !signingSecret) return json({ ok: false, error: "Webhook is not configured." }, 503);

  const rawBody = await req.text();
  if (!await verified(rawBody, req.headers.get("mux-signature"))) return json({ ok: false, error: "Invalid webhook signature." }, 401);

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return json({ ok: false, error: "Invalid JSON." }, 400); }

  const eventId = typeof event?.id === "string" ? event.id : "";
  const eventType = typeof event?.type === "string" ? event.type : "";
  const data = event?.data ?? {};
  if (!eventId || !eventType) return json({ ok: false, error: "Mux event id/type required." }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const liveStreamId = typeof data?.id === "string" && eventType.startsWith("video.live_stream.") ? data.id : (typeof data?.live_stream_id === "string" ? data.live_stream_id : null);
  const targetId = typeof data?.id === "string" && eventType.includes("simulcast_target") ? data.id : null;

  const { error: ledgerError } = await db.from("tv_mux_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    mux_live_stream_id: liveStreamId,
    simulcast_target_id: targetId,
    payload: event,
  });
  if (ledgerError?.code === "23505") return json({ ok: true, duplicate: true });
  if (ledgerError) return json({ ok: false, error: "Could not persist webhook event." }, 500);

  if (eventType.startsWith("video.live_stream.simulcast_target.")) {
    const target = data;
    const targetLiveStreamId = typeof target?.live_stream_id === "string" ? target.live_stream_id : liveStreamId;
    if (targetLiveStreamId) {
      const status = String(target?.status || eventType.split(".").pop() || "idle");
      const error = target?.error?.message || target?.error || null;
      await db.from("live_streams")
        .update({ youtube_status: status, youtube_error: error ? String(error).slice(0, 1000) : null })
        .eq("mux_live_stream_id", targetLiveStreamId)
        .eq("youtube_simulcast_target_id", targetId || "");
    }
  } else if (eventType.startsWith("video.live_stream.")) {
    const statusMap: Record<string, string> = {
      connected: "connected",
      active: "active",
      recording: "recording",
      disconnected: "disconnected",
      idle: "idle",
      warning: "warning",
    };
    const suffix = eventType.split(".").pop() || "";
    const muxStatus = statusMap[suffix] || String(data?.status || "idle");
    const active = muxStatus === "active" || muxStatus === "recording" || muxStatus === "connected";
    await db.from("live_streams")
      .update({
        mux_status: muxStatus,
        mux_active_asset_id: data?.active_asset_id || null,
        tv_connection_state: active ? "connected" : muxStatus === "disconnected" ? "degraded" : "starting",
      })
      .eq("mux_live_stream_id", liveStreamId || "");
  }

  return json({ ok: true });
});