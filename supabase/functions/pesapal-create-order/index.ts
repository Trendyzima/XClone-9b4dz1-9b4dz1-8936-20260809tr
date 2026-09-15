import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PESAPAL_ENV = (Deno.env.get("PESAPAL_ENV") || "live").toLowerCase();
const API = PESAPAL_ENV === "sandbox" ? "https://cybqa.pesapal.com/pesapalv3/api" : "https://pay.pesapal.com/v3/api";
const APP_URL = (Deno.env.get("APP_URL") || "https://www.testagram.site").replace(/\/$/, "");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MERCHANTS: Record<string, { key: string; secret: string; ipn: string; currency: string; iso2: string }> = {
  KE: { key: "PESAPAL_KE_CONSUMER_KEY", secret: "PESAPAL_KE_CONSUMER_SECRET", ipn: "PESAPAL_KE_IPN_ID", currency: "KES", iso2: "KE" },
  UG: { key: "PESAPAL_UG_CONSUMER_KEY", secret: "PESAPAL_UG_CONSUMER_SECRET", ipn: "PESAPAL_UG_IPN_ID", currency: "UGX", iso2: "UG" },
  TZ: { key: "PESAPAL_TZ_CONSUMER_KEY", secret: "PESAPAL_TZ_CONSUMER_SECRET", ipn: "PESAPAL_TZ_IPN_ID", currency: "TZS", iso2: "TZ" },
  MW: { key: "PESAPAL_MW_CONSUMER_KEY", secret: "PESAPAL_MW_CONSUMER_SECRET", ipn: "PESAPAL_MW_IPN_ID", currency: "MWK", iso2: "MW" },
  RW: { key: "PESAPAL_RW_CONSUMER_KEY", secret: "PESAPAL_RW_CONSUMER_SECRET", ipn: "PESAPAL_RW_IPN_ID", currency: "RWF", iso2: "RW" },
  ZM: { key: "PESAPAL_ZM_CONSUMER_KEY", secret: "PESAPAL_ZM_CONSUMER_SECRET", ipn: "PESAPAL_ZM_IPN_ID", currency: "ZMW", iso2: "ZM" },
  ZW: { key: "PESAPAL_ZW_CONSUMER_KEY", secret: "PESAPAL_ZW_CONSUMER_SECRET", ipn: "PESAPAL_ZW_IPN_ID", currency: "ZWL", iso2: "ZW" },
};
const CURRENCY_COUNTRY: Record<string, string> = { KES: "KE", UGX: "UG", TZS: "TZ", MWK: "MW", RWF: "RW", ZMW: "ZM", ZWL: "ZW" };
const PHONE_COUNTRY: Array<[RegExp, string]> = [[/^254/, "KE"], [/^256/, "UG"], [/^255/, "TZ"], [/^265/, "MW"], [/^250/, "RW"], [/^260/, "ZM"], [/^263/, "ZW"]];
function normalizePhone(value: string) { const raw = value.replace(/[^\d+]/g, ""); if (raw.startsWith("+")) return raw.slice(1); if (raw.startsWith("00")) return raw.slice(2); if (raw.startsWith("0") && raw.length === 10) return `254${raw.slice(1)}`; return raw; }
function countryFromPhone(phone: string) { const p = normalizePhone(phone); return PHONE_COUNTRY.find(([rx]) => rx.test(p))?.[1] || ""; }
function resolveCountry(input: any, currency: string, phone: string) { const explicit = String(input.merchant_country || input.country || "").trim().toUpperCase(); return explicit && MERCHANTS[explicit] ? explicit : CURRENCY_COUNTRY[currency] || countryFromPhone(phone) || "KE"; }
function credentials(country: string) { const m = MERCHANTS[country]; if (!m) throw new Error("Unsupported Pesapal merchant country"); const key = Deno.env.get(m.key) || ""; const secret = Deno.env.get(m.secret) || ""; const ipn = Deno.env.get(m.ipn) || Deno.env.get("PESAPAL_IPN_ID") || ""; if (!key || !secret) throw new Error(`Pesapal ${country} merchant credentials are not configured`); if (!ipn) throw new Error(`Pesapal ${country} IPN ID is not configured`); return { ...m, key, secret, ipn }; }
async function userFromToken(token: string) { const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }); if (!response.ok) return null; return await response.json(); }
async function db(path: string, init: RequestInit = {}) { const headers = new Headers(init.headers); headers.set("apikey", SERVICE_ROLE_KEY); headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`); headers.set("Content-Type", "application/json"); const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers }); if (!response.ok) throw new Error(`Database ${response.status}: ${(await response.text()).slice(0, 500)}`); return response; }
async function pesapalToken(key: string, secret: string) { const response = await fetch(`${API}/Auth/RequestToken`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ consumer_key: key, consumer_secret: secret }) }); const data = await response.json(); if (!response.ok || !data.token) throw new Error(`Pesapal authentication failed: ${data.message || response.status}`); return data.token as string; }
function safeReference(userId: string) { return `TS-${crypto.randomUUID()}-${userId.replaceAll("-", "").slice(0, 8)}`.slice(0, 50); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authorization = req.headers.get("authorization") || ""; const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);
    const user = await userFromToken(token); if (!user?.id) return json({ error: "Invalid session" }, 401);
    const input = await req.json();
    const walletResponse = await db(`wallets?user_id=eq.${encodeURIComponent(user.id)}&select=id,currency,balance,status,spending_enabled&limit=1`); const wallets = await walletResponse.json(); const wallet = wallets?.[0];
    if (!wallet?.id) return json({ error: "Wallet is not initialized" }, 409); if (wallet.status !== "active" || wallet.spending_enabled === false) return json({ error: "Wallet is unavailable" }, 403);
    const amount = Number(input.amount); if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return json({ error: "Invalid payment amount" }, 400);
    const currency = String(input.currency || wallet.currency || "USD").trim().toUpperCase(); if (currency !== String(wallet.currency || "USD").toUpperCase()) return json({ error: "Payment currency must match the wallet currency", wallet_currency: wallet.currency }, 400);
    const email = String(input.email || user.email || "").trim(); const phone = String(input.phone || "").trim(); if (!email || !phone) return json({ error: "Email and phone are required" }, 400);
    const merchantCountry = resolveCountry(input, currency, phone); const merchant = credentials(merchantCountry);
    if (currency !== "USD" && currency !== merchant.currency) return json({ error: `Currency ${currency} is not served by the ${merchantCountry} Pesapal merchant`, merchant_country: merchantCountry, expected_currency: merchant.currency }, 400);
    const description = String(input.description || "Testagram wallet top-up").slice(0, 100); const reference = safeReference(user.id); const callbackUrl = `${APP_URL}/wallet?pesapal=callback`; const cancellationUrl = `${APP_URL}/wallet?pesapal=cancelled`;
    const tokenValue = await pesapalToken(merchant.key, merchant.secret);
    const orderResponse = await fetch(`${API}/Transactions/SubmitOrderRequest`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${tokenValue}` }, body: JSON.stringify({ id: reference, currency, amount: Number(amount.toFixed(2)), description, callback_url: callbackUrl, cancellation_url: cancellationUrl, redirect_mode: "TOP_WINDOW", notification_id: merchant.ipn, billing_address: { email_address: email, phone_number: phone, country_code: merchant.iso2, first_name: String(input.firstName || "Testagram").slice(0, 50), middle_name: "", last_name: String(input.lastName || "User").slice(0, 50), line_1: "", line_2: "", city: "", state: "", postal_code: "", zip_code: "" } }) });
    const result = await orderResponse.json(); if (!orderResponse.ok || !result.order_tracking_id || !result.redirect_url) return json({ error: "Pesapal order creation failed", provider: { status: result.status, message: result.message, error: result.error } }, 502);
    const txResponse = await db("wallet_transactions", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: user.id, wallet_id: wallet.id, kind: "topup", type: "deposit", amount_cents: Math.round(amount * 100), amount: Number(amount.toFixed(2)), currency, direction: "credit", status: "pending", provider: "pesapal", provider_order_id: result.order_tracking_id, provider_reference: reference, provider_status: "PENDING", payment_method: "pesapal", description, metadata: { pesapal_merchant_reference: reference, pesapal_merchant_country: merchantCountry } }) });
    const txRows = await txResponse.json(); const tx = txRows?.[0]; if (!tx?.id) throw new Error("Unable to initialize wallet transaction");
    try { await db("pesapal_payment_orders", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, wallet_id: wallet.id, wallet_transaction_id: tx.id, wallet_amount: Number(amount.toFixed(2)), wallet_currency: currency, merchant_reference: reference, order_tracking_id: result.order_tracking_id, amount: Number(amount.toFixed(2)), currency, description, callback_url: callbackUrl, cancellation_url: cancellationUrl, redirect_url: result.redirect_url, status: "PENDING", provider_status_code: null, provider_status_description: "PENDING", raw_submit_response: result, merchant_country: merchantCountry }) }); } catch (error) { await db(`wallet_transactions?id=eq.${encodeURIComponent(tx.id)}`, { method: "DELETE" }).catch(() => undefined); throw error; }
    return json({ ok: true, merchant_reference: reference, order_tracking_id: result.order_tracking_id, redirect_url: result.redirect_url, callback_url: callbackUrl, currency, amount: Number(amount.toFixed(2)), merchant_country: merchantCountry });
  } catch (error) { console.error("pesapal-create-order", error); return json({ error: error instanceof Error ? error.message : "Unable to create Pesapal order" }, 500); }
});