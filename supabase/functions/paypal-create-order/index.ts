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
const APP_URL = Deno.env.get("APP_URL") || "https://www.testagram.site";
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
    if (!BASE || !CLIENT_ID || !CLIENT_SECRET) return json({ error: "PayPal is not fully configured." }, 503);

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    const currency = String(body.currency || "USD").toUpperCase();
    const email = typeof body.paypal_email === "string" ? body.paypal_email.trim().toLowerCase() : "";
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return json({ error: "Enter a valid amount between 1 and 100,000 USD." }, 400);
    if (currency !== "USD") return json({ error: "PayPal wallet top-ups currently support USD only." }, 400);
    if (email && (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email))) return json({ error: "Enter a valid PayPal email address." }, 400);

    const uid = user.id;
    const walletResult = await admin.rpc("ensure_user_wallet", { p_user_id: uid, p_currency: currency });
    if (walletResult.error || !walletResult.data?.id) return json({ error: "Wallet provisioning failed" }, 500);
    const wallet = walletResult.data;
    if (wallet.currency !== currency && Number(wallet.balance) !== 0) return json({ error: "Wallet currency is fixed once funded" }, 409);
    if (email) await admin.from("wallets").update({ paypal_email: email, updated_at: new Date().toISOString() }).eq("id", wallet.id).eq("user_id", uid);

    const amountCents = Math.round(amount * 100);
    const requestId = `paypal:${crypto.randomUUID()}`;
    const tx = await admin.from("wallet_transactions").insert({ user_id: uid, wallet_id: wallet.id, kind: "topup", type: "deposit", amount, amount_cents: amountCents, currency, direction: "credit", status: "pending", provider: "paypal", provider_reference: requestId, provider_status: "CREATING", payment_method: "paypal", description: "PayPal wallet top-up", metadata: { paypal_email: email || null } }).select("id").single();
    if (tx.error || !tx.data?.id) return json({ error: "Unable to create payment intent" }, 500);

    const accessToken = await paypalToken();
    const payload = {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: wallet.id, custom_id: uid, amount: { currency_code: currency, value: amount.toFixed(2) }, description: "Testagram wallet top-up" }],
      payment_source: { paypal: { experience_context: { brand_name: "Testagram", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: `${APP_URL}/wallet?paypal=return`, cancel_url: `${APP_URL}/wallet?paypal=cancelled` } } },
    };
    const response = await fetch(`${BASE}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "PayPal-Request-Id": requestId, Prefer: "return=representation" }, body: JSON.stringify(payload) });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok || !raw?.id) {
      await admin.from("wallet_transactions").update({ status: "failed", provider_status: `CREATE_FAILED_${response.status}` }).eq("id", tx.data.id).eq("status", "pending");
      return json({ error: "PayPal order creation failed", detail: raw?.message || raw?.name || "PayPal rejected the order" }, 502);
    }

    const approvalUrl = raw.links?.find((link: { rel?: string }) => link.rel === "payer-action" || link.rel === "approve")?.href || null;
    if (!approvalUrl) {
      await admin.from("wallet_transactions").update({ status: "failed", provider_status: "APPROVAL_URL_MISSING", provider_order_id: raw.id }).eq("id", tx.data.id).eq("status", "pending");
      return json({ error: "PayPal approval URL was not returned" }, 502);
    }

    await admin.from("wallet_transactions").update({ provider_order_id: raw.id, provider_status: raw.status || "CREATED", metadata: { paypal_order_id: raw.id, paypal_email: email || null } }).eq("id", tx.data.id);
    const orderInsert = await admin.from("paypal_orders").insert({ user_id: uid, wallet_id: wallet.id, wallet_transaction_id: tx.data.id, transaction_id: null, paypal_order_id: raw.id, order_id: raw.id, amount_cents: amountCents, amount, currency, status: "pending", approval_url: approvalUrl, metadata: { paypal_order_id: raw.id, paypal_email: email || null }, updated_at: new Date().toISOString() });
    if (orderInsert.error) return json({ ok: true, status: "pending_reconciliation", orderId: raw.id, approvalUrl, currency, amount }, 202);
    return json({ ok: true, orderId: raw.id, status: raw.status || "CREATED", approvalUrl, currency, amount });
  } catch (error) {
    console.error("PayPal create-order error", error);
    return json({ error: "PayPal order creation failed" }, 500);
  }
});
