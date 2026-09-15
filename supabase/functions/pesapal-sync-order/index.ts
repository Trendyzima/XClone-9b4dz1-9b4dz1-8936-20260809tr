import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PESAPAL_ENV = (Deno.env.get("PESAPAL_ENV") || "live").toLowerCase();
const API = PESAPAL_ENV === "sandbox" ? "https://cybqa.pesapal.com/pesapalv3/api" : "https://pay.pesapal.com/v3/api";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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
async function userFromToken(token: string) { const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }); if (!response.ok) return null; return await response.json(); }
function credentials(country: string) { const m = MERCHANTS[country]; if (!m) throw new Error("Unsupported Pesapal merchant country"); const key = Deno.env.get(m.key) || ""; const secret = Deno.env.get(m.secret) || ""; if (!key || !secret) throw new Error(`Pesapal ${country} merchant credentials are not configured`); return { key, secret }; }
async function token(country: string) { const c = credentials(country); const response = await fetch(`${API}/Auth/RequestToken`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ consumer_key: c.key, consumer_secret: c.secret }) }); const data = await response.json(); if (!response.ok || !data.token) throw new Error(`Pesapal authentication failed: ${data.message || response.status}`); return data.token as string; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authorization = req.headers.get("authorization") || "";
    const bearer = authorization.replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Authentication required" }, 401);
    const user = await userFromToken(bearer);
    if (!user?.id) return json({ error: "Invalid session" }, 401);
    const input = await req.json();
    const tracking = String(input.orderTrackingId || input.order_tracking_id || "").trim();
    const reference = String(input.merchantReference || input.merchant_reference || "").trim();
    if (!tracking && !reference) return json({ error: "orderTrackingId or merchantReference is required" }, 400);
    const filter = tracking ? `order_tracking_id=eq.${encodeURIComponent(tracking)}` : `merchant_reference=eq.${encodeURIComponent(reference)}`;
    const orderResponse = await db(`pesapal_payment_orders?${filter}&select=id,user_id,wallet_id,wallet_transaction_id,merchant_reference,order_tracking_id,amount,currency,merchant_country,status&limit=1`);
    const orders = await orderResponse.json();
    const order = orders?.[0];
    if (!order) return json({ error: "Pesapal order not found" }, 404);
    if (order.user_id !== user.id) return json({ error: "Not allowed" }, 403);
    const country = String(order.merchant_country || "KE").toUpperCase();
    const providerTracking = String(order.order_tracking_id || tracking);
    const statusResponse = await fetch(`${API}/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(providerTracking)}`, { headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${await token(country)}` } });
    const statusData = await statusResponse.json();
    if (!statusResponse.ok) return json({ error: "Pesapal status lookup failed", provider: statusData }, 502);
    const code = String(statusData.status_code ?? "");
    const description = String(statusData.payment_status_description || statusData.message || "");
    const settlementResponse = await db("rpc/finalize_pesapal_payment_order", { method: "POST", body: JSON.stringify({ p_merchant_reference: order.merchant_reference, p_provider_status_code: code, p_provider_status_description: description, p_status_response: statusData }) });
    const settlement = await settlementResponse.json();
    if (!settlementResponse.ok) throw new Error(settlement?.message || "Wallet settlement failed");
    return json({ ok: true, order_tracking_id: providerTracking, merchant_reference: order.merchant_reference, provider_status_code: code, provider_status_description: description, settlement });
  } catch (error) {
    console.error("pesapal-sync-order", error);
    return json({ error: error instanceof Error ? error.message : "Unable to synchronize Pesapal order" }, 500);
  }
});
