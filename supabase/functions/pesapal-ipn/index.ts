import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PESAPAL_ENV = (Deno.env.get("PESAPAL_ENV") || "live").toLowerCase();
const API = PESAPAL_ENV === "sandbox" ? "https://cybqa.pesapal.com/pesapalv3/api" : "https://pay.pesapal.com/v3/api";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const MERCHANTS: Record<string, { key: string; secret: string }> = {
  KE: { key: "PESAPAL_KE_CONSUMER_KEY", secret: "PESAPAL_KE_CONSUMER_SECRET" },
  UG: { key: "PESAPAL_UG_CONSUMER_KEY", secret: "PESAPAL_UG_CONSUMER_SECRET" },
  TZ: { key: "PESAPAL_TZ_CONSUMER_KEY", secret: "PESAPAL_TZ_CONSUMER_SECRET" },
  MW: { key: "PESAPAL_MW_CONSUMER_KEY", secret: "PESAPAL_MW_CONSUMER_SECRET" },
  RW: { key: "PESAPAL_RW_CONSUMER_KEY", secret: "PESAPAL_RW_CONSUMER_SECRET" },
  ZM: { key: "PESAPAL_ZM_CONSUMER_KEY", secret: "PESAPAL_ZM_CONSUMER_SECRET" },
  ZW: { key: "PESAPAL_ZW_CONSUMER_KEY", secret: "PESAPAL_ZW_CONSUMER_SECRET" },
};
async function db(path: string, init: RequestInit = {}) { const headers = new Headers(init.headers); headers.set("apikey", SERVICE_ROLE_KEY); headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`); headers.set("Content-Type", "application/json"); const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers }); if (!response.ok) throw new Error(`Database ${response.status}: ${(await response.text()).slice(0, 500)}`); return response; }
function credentials(country: string) { const m = MERCHANTS[country]; if (m) { const key = Deno.env.get(m.key) || ""; const secret = Deno.env.get(m.secret) || ""; if (key && secret) return { key, secret }; } const key = Deno.env.get("PESAPAL_CONSUMER_KEY") || ""; const secret = Deno.env.get("PESAPAL_CONSUMER_SECRET") || ""; if (!key || !secret) throw new Error(`Pesapal ${country || "default"} merchant credentials are not configured`); return { key, secret }; }
async function token(country: string) { const c = credentials(country); const response = await fetch(`${API}/Auth/RequestToken`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ consumer_key: c.key, consumer_secret: c.secret }) }); const data = await response.json(); if (!response.ok || !data.token) throw new Error(`Pesapal authentication failed: ${data.message || response.status}`); return data.token as string; }
function params(req: Request, body: any) { const url = new URL(req.url); return { tracking: String(body.OrderTrackingId || body.orderTrackingId || url.searchParams.get("OrderTrackingId") || url.searchParams.get("orderTrackingId") || ""), reference: String(body.OrderMerchantReference || body.orderMerchantReference || url.searchParams.get("OrderMerchantReference") || url.searchParams.get("orderMerchantReference") || ""), type: String(body.OrderNotificationType || body.orderNotificationType || url.searchParams.get("OrderNotificationType") || url.searchParams.get("orderNotificationType") || "IPNCHANGE") }; }
Deno.serve(async (req) => {
  try {
    let body: any = {}; if (req.method === "POST") { const text = await req.text(); try { body = text ? JSON.parse(text) : {}; } catch { body = {}; } }
    const p = params(req, body); if (!p.tracking && !p.reference) return json({ orderNotificationType: p.type, orderTrackingId: p.tracking, orderMerchantReference: p.reference, status: 500 }, 400);
    const filter = p.tracking ? `order_tracking_id=eq.${encodeURIComponent(p.tracking)}` : `merchant_reference=eq.${encodeURIComponent(p.reference)}`;
    const orderResponse = await db(`pesapal_payment_orders?${filter}&select=id,merchant_reference,order_tracking_id,status,amount,currency,merchant_country`); const orders = await orderResponse.json(); const order = orders[0];
    if (!order) return json({ orderNotificationType: p.type, orderTrackingId: p.tracking, orderMerchantReference: p.reference, status: 500 }, 404);
    const tracking = p.tracking || order.order_tracking_id;
    const statusResponse = await fetch(`${API}/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(tracking)}`, { headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${await token(String(order.merchant_country || "KE").toUpperCase())}` } });
    const statusData = await statusResponse.json(); if (!statusResponse.ok) throw new Error(`Pesapal status lookup failed: ${statusData.message || statusResponse.status}`);
    const code = Number(statusData.status_code); const description = String(statusData.payment_status_description || statusData.message || ""); const normalized = code === 1 ? "COMPLETED" : code === 2 ? "FAILED" : code === 3 ? "CANCELLED" : code === 0 ? "INVALID" : "PENDING";
    const rpcResponse = await db("rpc/finalize_pesapal_payment_order", { method: "POST", body: JSON.stringify({ p_merchant_reference: order.merchant_reference, p_provider_status_code: String(code), p_provider_status_description: description || normalized, p_status_response: statusData }) }); const settlement = await rpcResponse.json();
    const patch: Record<string, unknown> = { ipn_payload: body, provider_status_code: String(code), provider_status_description: description || normalized, raw_status_response: statusData, status: normalized === "COMPLETED" ? "COMPLETED" : normalized, updated_at: new Date().toISOString() }; if (normalized === "COMPLETED") patch.paid_at = new Date().toISOString();
    await db(`pesapal_payment_orders?id=eq.${encodeURIComponent(order.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    return json({ orderNotificationType: p.type, orderTrackingId: tracking, orderMerchantReference: order.merchant_reference, merchant_country: order.merchant_country, status: 200, settlement });
  } catch (error) { console.error("pesapal-ipn", error); return json({ status: 500, error: "IPN reconciliation failed" }, 500); }
});