import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const ENV = (Deno.env.get("MPESA_ENV") || "live").toLowerCase();
const BASE = ENV === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
const KEY = Deno.env.get("MPESA_CONSUMER_KEY") || "";
const SECRET = Deno.env.get("MPESA_CONSUMER_SECRET") || "";
const SHORTCODE = Deno.env.get("MPESA_SHORTCODE") || "";
const PASSKEY = Deno.env.get("MPESA_PASSKEY") || "";
const RATE = Number(Deno.env.get("MPESA_USD_KES_RATE") || "130");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...cors, "Content-Type": "application/json" } });

function phone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `254${d.slice(1)}`;
  if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) return `254${d}`;
  throw new Error("INVALID_PHONE");
}

async function token() {
  if (!KEY || !SECRET) throw new Error("MPESA_CREDENTIALS_NOT_CONFIGURED");
  const r = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${btoa(`${KEY}:${SECRET}`)}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`MPESA_AUTH_${r.status}`);
  return data.access_token as string;
}

async function authenticatedUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth) return null;
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt || !ANON) return null;
  const client = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data } = await client.auth.getUser(jwt);
  return data.user || null;
}

async function handleCallback(body: any) {
  const stk = body?.Body?.stkCallback;
  if (!stk) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  const checkout = String(stk.CheckoutRequestID || "");
  if (!checkout) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  const resultCode = Number(stk.ResultCode);
  const resultDesc = String(stk.ResultDesc || "");
  let receipt: string | null = null;
  let amountKes: number | null = null;
  let callbackPhone: string | null = null;
  for (const item of stk.CallbackMetadata?.Item || []) {
    if (item.Name === "MpesaReceiptNumber") receipt = item.Value == null ? null : String(item.Value);
    if (item.Name === "Amount") amountKes = Number(item.Value);
    if (item.Name === "PhoneNumber") callbackPhone = item.Value == null ? null : String(item.Value);
  }
  const { data: payment } = await admin.from("mpesa_payments").select("id,amount_kes").eq("checkout_request_id", checkout).maybeSingle();
  if (!payment) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  if (resultCode === 0 && (!receipt || !Number.isFinite(amountKes) || amountKes <= 0 || Math.round(Number(payment.amount_kes) * 100) !== Math.round(Number(amountKes) * 100))) {
    console.error("[mpesa] callback verification failed", checkout);
    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  const { error } = await admin.rpc("finalize_mpesa_topup", { p_checkout_request_id: checkout, p_result_code: resultCode, p_receipt_number: receipt, p_result_description: resultDesc, p_callback_data: { ...body, callback_phone: callbackPhone } });
  if (error) console.error("[mpesa] finalize", error.message);
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.Body?.stkCallback) return await handleCallback(body);

    const user = await authenticatedUser(req);
    if (!user?.id) return json({ error: "Authentication required" }, 401);
    if (!KEY || !SECRET || !SHORTCODE || !PASSKEY) return json({ error: "M-Pesa STK Push is not fully configured. Consumer credentials, shortcode and passkey are required." }, 503);
    if (!Number.isFinite(RATE) || RATE <= 0) return json({ error: "Invalid M-Pesa wallet FX configuration" }, 503);

    const amountKes = Math.ceil(Number(body.amount_kes ?? body.amount));
    if (!Number.isFinite(amountKes) || amountKes < 10 || amountKes > 150000) return json({ error: "Enter a valid M-Pesa amount between KES 10 and KES 150,000." }, 400);
    const userPhone = phone(String(body.phone || ""));
    const { data: wallet, error: walletError } = await admin.from("wallets").select("id,currency,status,spending_enabled").eq("id", body?.metadata?.wallet_id || "").eq("user_id", user.id).maybeSingle();
    if (walletError || !wallet) return json({ error: "Wallet not found" }, 404);
    if (wallet.status !== "active" || wallet.spending_enabled === false) return json({ error: "Wallet is unavailable" }, 403);
    const walletCurrency = String(wallet.currency || "USD").toUpperCase();
    if (walletCurrency !== "USD" && walletCurrency !== "KES") return json({ error: "M-Pesa top-up currently supports USD or KES wallets only." }, 400);
    const walletAmount = walletCurrency === "KES" ? amountKes : Number((amountKes / RATE).toFixed(2));
    if (walletAmount <= 0) return json({ error: "Invalid wallet amount" }, 400);

    const access = await token();
    const now = new Date();
    const timestamp = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,"0")}${String(now.getUTCDate()).padStart(2,"0")}${String(now.getUTCHours()).padStart(2,"0")}${String(now.getUTCMinutes()).padStart(2,"0")}${String(now.getUTCSeconds()).padStart(2,"0")}`;
    const password = btoa(`${SHORTCODE}${PASSKEY}${timestamp}`);
    const callbackUrl = `${SUPABASE_URL}/functions/v1/mpesa-stk-push`;
    const reference = `TS${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`.slice(0, 12);
    const stk = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ BusinessShortCode: SHORTCODE, Password: password, Timestamp: timestamp, TransactionType: "CustomerPayBillOnline", Amount: amountKes, PartyA: userPhone, PartyB: SHORTCODE, PhoneNumber: userPhone, CallBackURL: callbackUrl, AccountReference: reference, TransactionDesc: "Testagram topup" }) });
    const provider = await stk.json().catch(() => ({}));
    if (!stk.ok || String(provider.ResponseCode) !== "0" || !provider.CheckoutRequestID) return json({ error: provider.errorMessage || provider.ResponseDescription || "M-Pesa STK Push failed" }, 502);

    const tx = await admin.from("wallet_transactions").insert({ user_id: user.id, wallet_id: wallet.id, kind: "topup", type: "deposit", amount: walletAmount, amount_cents: Math.round(walletAmount * 100), currency: walletCurrency, direction: "credit", status: "pending", provider: "mpesa", provider_order_id: provider.CheckoutRequestID, provider_reference: reference, provider_status: "PENDING", payment_method: "mpesa", description: `M-Pesa top-up KES ${amountKes.toLocaleString()}`, metadata: { mpesa_checkout_request_id: provider.CheckoutRequestID, mpesa_merchant_request_id: provider.MerchantRequestID, amount_kes: amountKes, fx_rate: walletCurrency === "USD" ? RATE : 1 } }).select("id").single();
    if (tx.error || !tx.data?.id) throw new Error("WALLET_TRANSACTION_CREATE_FAILED");
    const payment = await admin.from("mpesa_payments").insert({ user_id: user.id, wallet_id: wallet.id, wallet_transaction_id: tx.data.id, merchant_request_id: provider.MerchantRequestID, checkout_request_id: provider.CheckoutRequestID, amount_kes: amountKes, wallet_amount: walletAmount, wallet_currency: walletCurrency, phone: userPhone, status: "pending", raw_response: provider, callback_data: {} }).select("id").single();
    if (payment.error || !payment.data?.id) {
      await admin.from("wallet_transactions").delete().eq("id", tx.data.id).eq("status", "pending");
      throw new Error("MPESA_PAYMENT_CREATE_FAILED");
    }
    await admin.from("wallets").update({ mpesa_phone: userPhone }).eq("id", wallet.id).eq("user_id", user.id);
    return json({ success: true, status: "pending", checkout_request_id: provider.CheckoutRequestID, merchant_request_id: provider.MerchantRequestID, customer_message: `M-Pesa PIN prompt sent to ${userPhone}.`, amount_kes: amountKes, wallet_amount: walletAmount, wallet_currency: walletCurrency });
  } catch (error) {
    console.error("[mpesa]", error);
    return json({ error: error instanceof Error ? error.message : "M-Pesa request failed" }, 500);
  }
});
