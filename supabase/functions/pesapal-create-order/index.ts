import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PESAPAL_KEY = Deno.env.get("PESAPAL_CONSUMER_KEY") || Deno.env.get("PESAPAL_KEY") || "";
const PESAPAL_SECRET = Deno.env.get("PESAPAL_CONSUMER_SECRET") || Deno.env.get("PESAPAL_SECRET") || "";
const PESAPAL_IPN_ID = Deno.env.get("PESAPAL_IPN_ID") || "";
const PESAPAL_ENV = (Deno.env.get("PESAPAL_ENV") || "live").toLowerCase();
const APP_URL = (Deno.env.get("APP_URL") || "https://www.testagram.site").replace(/\/$/, "");
const API = PESAPAL_ENV === "sandbox" ? "https://cybqa.pesapal.com/pesapalv3/api" : "https://pay.pesapal.com/v3/api";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function userFromToken(token: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return await response.json();
}

async function db(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", SERVICE_ROLE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Database ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

async function pesapalToken() {
  if (!PESAPAL_KEY || !PESAPAL_SECRET) throw new Error("Pesapal credentials are not configured");
  const response = await fetch(`${API}/Auth/RequestToken`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ consumer_key: PESAPAL_KEY, consumer_secret: PESAPAL_SECRET }) });
  const data = await response.json();
  if (!response.ok || !data.token) throw new Error(`Pesapal authentication failed: ${data.message || response.status}`);
  return data.token as string;
}

function safeReference(userId: string) { return `TS-${crypto.randomUUID()}-${userId.replaceAll("-", "").slice(0, 8)}`.slice(0, 50); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);
    const user = await userFromToken(token);
    if (!user?.id) return json({ error: "Invalid session" }, 401);
    if (!PESAPAL_IPN_ID) return json({ error: "Pesapal IPN ID is not configured" }, 503);

    const input = await req.json();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return json({ error: "Invalid payment amount" }, 400);
    const email = String(input.email || user.email || "").trim();
    const phone = String(input.phone || "").trim();
    if (!email || !phone) return json({ error: "Email and phone are required" }, 400);
    const description = String(input.description || "Testagram payment").slice(0, 100);
    const reference = safeReference(user.id);
    const callbackUrl = `${APP_URL}/payment/callback`;
    const cancellationUrl = `${APP_URL}/payment/cancelled`;
    const tokenValue = await pesapalToken();
    const orderResponse = await fetch(`${API}/Transactions/SubmitOrderRequest`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${tokenValue}` }, body: JSON.stringify({ id: reference, currency: "KES", amount: Number(amount.toFixed(2)), description, callback_url: callbackUrl, cancellation_url: cancellationUrl, redirect_mode: "TOP_WINDOW", notification_id: PESAPAL_IPN_ID, billing_address: { email_address: email, phone_number: phone, country_code: "KE", first_name: String(input.firstName || "Testagram").slice(0, 50), middle_name: "", last_name: String(input.lastName || "User").slice(0, 50), line_1: "", line_2: "", city: "", state: "", postal_code: "", zip_code: "" } }) });
    const result = await orderResponse.json();
    if (!orderResponse.ok || !result.order_tracking_id || !result.redirect_url) return json({ error: "Pesapal order creation failed", provider: { status: result.status, message: result.message, error: result.error } }, 502);
    await db("pesapal_payment_orders", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, merchant_reference: reference, order_tracking_id: result.order_tracking_id, amount: Number(amount.toFixed(2)), currency: "KES", description, callback_url: callbackUrl, cancellation_url: cancellationUrl, redirect_url: result.redirect_url, provider_status: "PENDING", submit_response: result }) });
    return json({ ok: true, merchant_reference: reference, order_tracking_id: result.order_tracking_id, redirect_url: result.redirect_url, callback_url: callbackUrl });
  } catch (error) {
    console.error("pesapal-create-order", error);
    return json({ error: error instanceof Error ? error.message : "Unable to create Pesapal order" }, 500);
  }
});