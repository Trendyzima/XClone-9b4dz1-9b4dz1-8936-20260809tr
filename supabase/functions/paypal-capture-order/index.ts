import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET") || "";
const ENV = (Deno.env.get("PAYPAL_ENV") || "").toLowerCase();
const BASE = ENV === "live" ? "https://api-m.paypal.com" : ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "";
const CORS = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function paypalToken() {
  if (!BASE || !CLIENT_ID || !CLIENT_SECRET) throw new Error("PAYPAL_CONFIGURATION_INVALID");
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const response = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("PAYPAL_AUTH_FAILED");
  return String(payload.access_token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt || !ANON) return json({ error: "Authentication required" }, 401);
    const authClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Invalid authentication" }, 401);
    const body = await req.json().catch(() => ({}));
    const orderId = String(body.orderId || "");
    if (!orderId || orderId.length > 64) return json({ error: "orderId is required" }, 400);

    const { data: order, error: orderError } = await admin.from("paypal_orders").select("id,user_id,amount,amount_cents,currency,status,capture_id,paypal_capture_id").or(`order_id.eq.${orderId},paypal_order_id.eq.${orderId}`).eq("user_id", user.id).maybeSingle();
    if (orderError || !order) return json({ error: "Order not found" }, 404);
    const existingCapture = order.capture_id || order.paypal_capture_id;
    if (existingCapture) return json({ ok: true, alreadyCaptured: true, orderId, captureId: existingCapture });
    if (!BASE || !CLIENT_ID || !CLIENT_SECRET) return json({ error: "PayPal is not fully configured." }, 503);

    const accessToken = await paypalToken();
    const response = await fetch(`${BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "PayPal-Request-Id": `testagram-capture:${orderId}`, Prefer: "return=representation" }, body: "{}" });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: "PayPal capture failed", detail: raw?.message || raw?.name || "PayPal rejected the capture" }, 502);

    const capture = raw?.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture?.id || capture.status !== "COMPLETED") return json({ error: "Payment not completed", status: capture?.status || raw?.status || "UNKNOWN" }, 409);
    const paidAmount = Number(capture.amount?.value);
    const paidCurrency = String(capture.amount?.currency_code || "").toUpperCase();
    const expectedAmount = Number(order.amount ?? Number(order.amount_cents) / 100);
    const expectedCurrency = String(order.currency || "").toUpperCase();
    if (!Number.isFinite(paidAmount) || Math.round(paidAmount * 100) !== Math.round(expectedAmount * 100) || paidCurrency !== expectedCurrency) return json({ error: "Captured amount mismatch" }, 409);

    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_paypal_topup", { p_order_id: orderId, p_capture_id: String(capture.id) });
    if (finalizeError) return json({ error: "Wallet credit failed; payment requires reconciliation" }, 500);
    return json({ ok: true, orderId, captureId: String(capture.id), wallet: finalized });
  } catch (error) {
    console.error("PayPal capture-order error", error);
    return json({ error: "PayPal capture failed" }, 500);
  }
});
