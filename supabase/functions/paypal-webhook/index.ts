import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET") || "";
const WEBHOOK_ID = Deno.env.get("PAYPAL_WEBHOOK_ID") || "";
const ENV = (Deno.env.get("PAYPAL_ENV") || "").toLowerCase();
const BASE = ENV === "live" ? "https://api-m.paypal.com" : ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

async function paypalToken() {
  if (!BASE || !CLIENT_ID || !CLIENT_SECRET) throw new Error("PAYPAL_CONFIGURATION_INVALID");
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const response = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("PAYPAL_AUTH_FAILED");
  return String(payload.access_token);
}

async function verifyWebhook(headers: Headers, event: unknown) {
  if (!WEBHOOK_ID) throw new Error("PAYPAL_WEBHOOK_ID_NOT_CONFIGURED");
  const authAlgo = headers.get("paypal-auth-algo") || "";
  const certUrl = headers.get("paypal-cert-url") || "";
  const transmissionId = headers.get("paypal-transmission-id") || "";
  const transmissionSig = headers.get("paypal-transmission-sig") || "";
  const transmissionTime = headers.get("paypal-transmission-time") || "";
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return false;
  const accessToken = await paypalToken();
  const response = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ auth_algo: authAlgo, cert_url: certUrl, transmission_id: transmissionId, transmission_sig: transmissionSig, transmission_time: transmissionTime, webhook_id: WEBHOOK_ID, webhook_event: event }) });
  const payload = await response.json().catch(() => ({}));
  return response.ok && payload.verification_status === "SUCCESS";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const raw = await req.text();
  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    if (!(await verifyWebhook(req.headers, event))) return json({ error: "Invalid PayPal webhook signature" }, 400);
    const eventId = String(event?.id || "");
    const eventType = String(event?.event_type || "");
    if (!eventId || !eventType) return json({ error: "Invalid webhook event" }, 400);
    const resource = event?.resource || {};
    const captureId = String(resource?.id || "");
    const orderId = String(resource?.supplementary_data?.related_ids?.order_id || "");

    const { data: existing } = await admin.from("paypal_webhook_events").select("processed").eq("event_id", eventId).maybeSingle();
    if (existing?.processed) return json({ ok: true, duplicate: true });
    await admin.from("paypal_webhook_events").upsert({ event_id: eventId, event_type: eventType, paypal_order_id: orderId || null, paypal_capture_id: captureId || null, transmission_id: req.headers.get("paypal-transmission-id"), payload: event, verified: true, processed: false, processing_error: null, received_at: new Date().toISOString() }, { onConflict: "event_id" });

    if (eventType === "PAYMENT.CAPTURE.COMPLETED" && orderId && captureId) {
      const amount = Number(resource?.amount?.value);
      const currency = String(resource?.amount?.currency_code || "").toUpperCase();
      const { data: order, error } = await admin.from("paypal_orders").select("amount,amount_cents,currency").or(`order_id.eq.${orderId},paypal_order_id.eq.${orderId}`).maybeSingle();
      if (error || !order) throw new Error("PAYPAL_ORDER_NOT_FOUND");
      const expected = Number(order.amount ?? Number(order.amount_cents) / 100);
      if (!Number.isFinite(amount) || Math.round(amount * 100) !== Math.round(expected * 100) || currency !== String(order.currency).toUpperCase()) throw new Error("PAYPAL_CAPTURE_AMOUNT_MISMATCH");
      const result = await admin.rpc("finalize_paypal_topup", { p_order_id: orderId, p_capture_id: captureId });
      if (result.error) throw new Error(`PAYPAL_SETTLEMENT_FAILED:${result.error.message}`);
    } else if (eventType === "PAYMENT.CAPTURE.DENIED" && orderId) {
      const { data: order } = await admin.from("paypal_orders").select("id,wallet_transaction_id").or(`order_id.eq.${orderId},paypal_order_id.eq.${orderId}`).maybeSingle();
      if (order) {
        await admin.from("paypal_orders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", order.id);
        if (order.wallet_transaction_id) await admin.from("wallet_transactions").update({ status: "failed", provider_status: "DENIED" }).eq("id", order.wallet_transaction_id).eq("status", "pending");
      }
    }

    await admin.from("paypal_webhook_events").update({ processed: true, processed_at: new Date().toISOString(), processing_error: null }).eq("event_id", eventId);
    return json({ ok: true });
  } catch (error) {
    console.error("PayPal webhook processing failed", error);
    const eventId = String(event?.id || "");
    if (eventId) await admin.from("paypal_webhook_events").update({ processing_error: error instanceof Error ? error.message : "unknown error" }).eq("event_id", eventId);
    return json({ error: "Webhook processing failed" }, 500);
  }
});
