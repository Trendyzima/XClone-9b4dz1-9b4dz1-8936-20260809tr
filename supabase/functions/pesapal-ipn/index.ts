import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PESAPAL_KEY = Deno.env.get("PESAPAL_CONSUMER_KEY") || Deno.env.get("PESAPAL_KEY") || "";
const PESAPAL_SECRET = Deno.env.get("PESAPAL_CONSUMER_SECRET") || Deno.env.get("PESAPAL_SECRET") || "";
const PESAPAL_ENV = (Deno.env.get("PESAPAL_ENV") || "live").toLowerCase();
const API = PESAPAL_ENV === "sandbox" ? "https://cybqa.pesapal.com/pesapalv3/api" : "https://pay.pesapal.com/v3/api";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); headers.set("apikey", SERVICE_ROLE_KEY); headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`); headers.set("Content-Type", "application/json");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Database ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}
async function token() {
  const response = await fetch(`${API}/Auth/RequestToken`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ consumer_key: PESAPAL_KEY, consumer_secret: PESAPAL_SECRET }) });
  const data = await response.json(); if (!response.ok || !data.token) throw new Error(`Pesapal authentication failed: ${data.message || response.status}`); return data.token;
}
function params(req: Request, body: any) { const url = new URL(req.url); return { tracking: String(body.OrderTrackingId || body.orderTrackingId || url.searchParams.get("OrderTrackingId") || url.searchParams.get("orderTrackingId") || ""), reference: String(body.OrderMerchantReference || body.orderMerchantReference || url.searchParams.get("OrderMerchantReference") || url.searchParams.get("orderMerchantReference") || ""), type: String(body.OrderNotificationType || body.orderNotificationType || url.searchParams.get("OrderNotificationType") || "IPNCHANGE") }; }

Deno.serve(async (req) => {
  try {
    let body: any = {}; if (req.method === "POST") { const text = await req.text(); try { body = text ? JSON.parse(text) : {}; } catch { body = {}; } }
    const p = params(req, body); if (!p.tracking && !p.reference) return json({ orderNotificationType: p.type, orderTrackingId: p.tracking, orderMerchantReference: p.reference, status: 500 }, 400);
    const filter = p.tracking ? `order_tracking_id=eq.${encodeURIComponent(p.tracking)}` : `merchant_reference=eq.${encodeURIComponent(p.reference)}`;
    const orderResponse = await db(`pesapal_payment_orders?${filter}&select=*`); const orders = await orderResponse.json(); const order = orders[0];
    if (!order) return json({ orderNotificationType: p.type, orderTrackingId: p.tracking, orderMerchantReference: p.reference, status: 500 }, 404);
    if (!order.provider_status || !["COMPLETED", "FAILED", "REVERSED", "CANCELLED"].includes(String(order.provider_status).toUpperCase())) {
      const statusResponse = await fetch(`${API}/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(p.tracking || order.order_tracking_id)}`, { headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${await token()}` } });
      const statusData = await statusResponse.json();
      const code = Number(statusData.status_code); const normalized = code === 1 ? "COMPLETED" : code === 2 ? "FAILED" : code === 3 ? "REVERSED" : code === 0 ? "INVALID" : "PENDING";
      await db(`pesapal_payment_orders?id=eq.${encodeURIComponent(order.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ order_tracking_id: p.tracking || order.order_tracking_id, merchant_reference: p.reference || order.merchant_reference, provider_status: normalized, payment_method: statusData.payment_method || null, confirmation_code: statusData.confirmation_code || null, provider_status_code: code, status_response: statusData, ipn_payload: body, completed_at: normalized === "COMPLETED" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }) });
    } else { await db(`pesapal_payment_orders?id=eq.${encodeURIComponent(order.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ipn_payload: body, updated_at: new Date().toISOString() }) }); }
    return json({ orderNotificationType: p.type, orderTrackingId: p.tracking || order.order_tracking_id, orderMerchantReference: p.reference || order.merchant_reference, status: 200 });
  } catch (error) { console.error("pesapal-ipn", error); return json({ status: 500, error: "IPN reconciliation failed" }, 500); }
});