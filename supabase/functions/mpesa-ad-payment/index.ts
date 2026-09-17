import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const ENV = (Deno.env.get("MPESA_ENV") || "").toLowerCase();
const BASE = ENV === "sandbox" ? "https://sandbox.safaricom.co.ke" : ENV === "live" ? "https://api.safaricom.co.ke" : "";
const KEY = Deno.env.get("MPESA_CONSUMER_KEY") || "";
const SECRET = Deno.env.get("MPESA_CONSUMER_SECRET") || "";
const SHORTCODE = Deno.env.get("MPESA_SHORTCODE") || "";
const PASSKEY = Deno.env.get("MPESA_PASSKEY") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });

function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `254${digits}`;
  throw new Error("INVALID_PHONE");
}

function configError() {
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) return "SUPABASE_FUNCTION_CONFIGURATION_INVALID";
  if (!BASE) return "MPESA_ENV_MUST_BE_LIVE_OR_SANDBOX";
  if (!KEY || !SECRET || !SHORTCODE || !PASSKEY) return "MPESA_CREDENTIALS_NOT_CONFIGURED";
  return null;
}

async function authenticatedUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  if (!jwt || !ANON) return null;
  const client = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(jwt);
  return data.user || null;
}

async function accessToken() {
  const response = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${btoa(`${KEY}:${SECRET}`)}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`MPESA_AUTH_${response.status}`);
  return String(data.access_token);
}

function timestamp() {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
}

async function verifyProvider(checkout: string) {
  const token = await accessToken();
  const ts = timestamp();
  const response = await fetch(`${BASE}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: SHORTCODE, Password: btoa(`${SHORTCODE}${PASSKEY}${ts}`), Timestamp: ts, CheckoutRequestID: checkout }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || String(data.ResponseCode) !== "0" || String(data.ResultCode) !== "0") throw new Error("MPESA_PROVIDER_PAYMENT_NOT_CONFIRMED");
  return data as Record<string, unknown>;
}

async function findAdPayment(checkout: string) {
  for (const delay of [0, 250, 500, 1000, 2000, 3000, 5000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const { data, error } = await admin.from("zenad_mpesa_payments").select("id,user_id,ad_id,wallet_id,wallet_transaction_id,mpesa_payment_id,amount_kes,status").eq("checkout_request_id", checkout).maybeSingle();
    if (error) throw new Error(`AD_PAYMENT_LOOKUP_FAILED:${error.message}`);
    if (data) return data;
  }
  return null;
}

async function handleCallback(body: any) {
  const stk = body?.Body?.stkCallback;
  if (!stk) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  const checkout = String(stk.CheckoutRequestID || "");
  const resultCode = Number(stk.ResultCode);
  const resultDescription = String(stk.ResultDesc || "");
  if (!checkout || !Number.isInteger(resultCode)) return json({ ResultCode: 1, ResultDesc: "Invalid callback" }, 400);

  const payment = await findAdPayment(checkout);
  if (!payment) return json({ ResultCode: 1, ResultDesc: "Payment record not available; retry callback" }, 500);

  let receipt: string | null = null;
  let amountKes: number | null = null;
  let callbackPhone: string | null = null;
  for (const item of stk.CallbackMetadata?.Item || []) {
    if (item.Name === "MpesaReceiptNumber") receipt = item.Value == null ? null : String(item.Value);
    if (item.Name === "Amount") amountKes = Number(item.Value);
    if (item.Name === "PhoneNumber") callbackPhone = item.Value == null ? null : String(item.Value);
  }

  let providerResponse: Record<string, unknown> = {};
  if (resultCode === 0) {
    if (!receipt || !Number.isFinite(amountKes) || Math.round(amountKes * 100) !== Math.round(Number(payment.amount_kes) * 100)) return json({ ResultCode: 1, ResultDesc: "Callback verification failed" }, 400);
    try {
      providerResponse = await verifyProvider(checkout);
    } catch (error) {
      console.error("[mpesa-ad] provider verification failed", checkout, error instanceof Error ? error.message : String(error));
      return json({ ResultCode: 1, ResultDesc: "Provider payment not yet confirmed; retry callback" }, 500);
    }
  }

  const { data: settlement, error } = await admin.rpc("finalize_zenad_mpesa_ad_payment", {
    p_checkout_request_id: checkout,
    p_result_code: resultCode,
    p_receipt_number: receipt,
    p_result_description: resultDescription,
    p_amount_kes: amountKes,
    p_callback_data: { ...body, callback_phone: callbackPhone },
    p_provider_response: providerResponse,
  });
  if (error) {
    console.error("[mpesa-ad] settlement failed", checkout, error.message);
    return json({ ResultCode: 1, ResultDesc: "Settlement failed; retry callback" }, 500);
  }
  if (!settlement?.ok) return json({ ResultCode: 1, ResultDesc: "Settlement incomplete; retry callback" }, 500);
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.Body?.stkCallback) return await handleCallback(body);

    const user = await authenticatedUser(req);
    if (!user?.id) return json({ error: "Authentication required" }, 401);
    const error = configError();
    if (error) return json({ error: "M-Pesa STK Push is not fully configured." }, 503);

    const adId = String(body.ad_id || "");
    const requestedAmount = Number(body.amount_kes);
    if (!adId) return json({ error: "ad_id is required" }, 400);

    const { data: campaign, error: campaignError } = await admin
      .from("zenad_campaigns")
      .select("id,advertiser_id,status,currency,lifetime_budget_micros,payment_status,payment_reference,starts_at,ends_at")
      .eq("id", adId)
      .maybeSingle();
    if (campaignError) throw new Error(`CAMPAIGN_LOOKUP_FAILED:${campaignError.message}`);
    if (!campaign) return json({ error: "Advertisement not found" }, 404);

    const { data: advertiser } = await admin.from("zenad_advertisers").select("id,owner_user_id,status").eq("id", campaign.advertiser_id).maybeSingle();
    if (!advertiser || advertiser.owner_user_id !== user.id) return json({ error: "Advertisement not found" }, 404);
    if (campaign.payment_status === "funded") return json({ error: "Advertisement is already paid" }, 409);
    if (String(campaign.currency).toUpperCase() !== "KES") return json({ error: "Advertisement billing currency must be KES" }, 400);

    const budgetKes = Number(campaign.lifetime_budget_micros) / 1_000_000;
    if (!Number.isFinite(budgetKes) || budgetKes < 10 || budgetKes > 150000) return json({ error: "Advertisement budget is invalid" }, 400);
    if (!Number.isFinite(requestedAmount) || Math.ceil(requestedAmount) !== Math.ceil(budgetKes)) return json({ error: "Payment amount does not match the advertisement budget" }, 400);
    const userPhone = normalizePhone(String(body.phone || ""));

    const { data: wallet, error: walletError } = await admin.from("wallets").select("id,currency,status,spending_enabled").eq("user_id", user.id).eq("currency", "KES").maybeSingle();
    if (walletError) throw new Error(`WALLET_LOOKUP_FAILED:${walletError.message}`);
    if (!wallet) return json({ error: "KES wallet required for ad payment" }, 409);
    if (wallet.status !== "active" || wallet.spending_enabled === false) return json({ error: "Wallet is unavailable" }, 403);

    const { data: existing } = await admin.from("zenad_mpesa_payments").select("checkout_request_id,status").eq("ad_id", adId).eq("user_id", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing?.checkout_request_id) return json({ success: true, status: "pending", checkout_request_id: existing.checkout_request_id });

    const { data: walletTx, error: txError } = await admin.from("wallet_transactions").insert({
      user_id: user.id, wallet_id: wallet.id, kind: "topup", type: "deposit", amount: budgetKes, amount_cents: Math.round(budgetKes * 100), currency: "KES", direction: "credit", status: "pending", provider: "mpesa", provider_status: "PENDING", payment_method: "mpesa", description: `M-Pesa ad payment ${adId.slice(0, 8)}`, metadata: { ad_id: adId, amount_kes: budgetKes, phone: userPhone }
    }).select("id").single();
    if (txError || !walletTx?.id) throw new Error(`WALLET_TRANSACTION_CREATE_FAILED:${txError?.message || "unknown"}`);

    const token = await accessToken();
    const ts = timestamp();
    const reference = `TA${adId.replaceAll("-", "").slice(0, 10)}`.slice(0, 12);
    const callbackUrl = `${SUPABASE_URL}/functions/v1/mpesa-ad-payment`;
    const stkResponse = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ BusinessShortCode: SHORTCODE, Password: btoa(`${SHORTCODE}${PASSKEY}${ts}`), Timestamp: ts, TransactionType: "CustomerPayBillOnline", Amount: budgetKes, PartyA: userPhone, PartyB: SHORTCODE, PhoneNumber: userPhone, CallBackURL: callbackUrl, AccountReference: reference, TransactionDesc: `Testagram ad ${adId.slice(0, 8)}` }),
    });
    const provider = await stkResponse.json().catch(() => ({}));
    if (!stkResponse.ok || String(provider.ResponseCode) !== "0" || !provider.CheckoutRequestID) {
      await admin.from("wallet_transactions").update({ status: "failed", provider_status: String(provider.errorMessage || provider.ResponseDescription || "M-Pesa STK Push failed") }).eq("id", walletTx.id).eq("status", "pending");
      return json({ error: provider.errorMessage || provider.ResponseDescription || "M-Pesa STK Push failed" }, 502);
    }

    const { data: mpesaPayment, error: mpesaPaymentError } = await admin.from("mpesa_payments").insert({ user_id: user.id, wallet_id: wallet.id, wallet_transaction_id: walletTx.id, merchant_request_id: String(provider.MerchantRequestID || ""), checkout_request_id: String(provider.CheckoutRequestID), amount_kes: budgetKes, wallet_amount: budgetKes, wallet_currency: "KES", phone: userPhone, status: "pending", raw_response: provider, callback_data: {} }).select("id").single();
    if (mpesaPaymentError || !mpesaPayment?.id) throw new Error(`MPESA_PAYMENT_CREATE_FAILED:${mpesaPaymentError?.message || "unknown"}`);

    const { error: adPaymentError } = await admin.from("zenad_mpesa_payments").insert({ user_id: user.id, ad_id: adId, wallet_id: wallet.id, wallet_transaction_id: walletTx.id, mpesa_payment_id: mpesaPayment.id, amount_kes: budgetKes, phone: userPhone, merchant_request_id: String(provider.MerchantRequestID || ""), checkout_request_id: String(provider.CheckoutRequestID), status: "pending", provider_response: provider });
    if (adPaymentError) {
      console.error("[mpesa-ad] ad payment ledger persistence failed", adPaymentError.message);
      return json({ error: "M-Pesa request accepted but payment recording is being reconciled. Do not retry immediately." }, 202);
    }

    await admin.from("wallets").update({ mpesa_phone: userPhone }).eq("id", wallet.id).eq("user_id", user.id);
    return json({ success: true, status: "pending", checkout_request_id: String(provider.CheckoutRequestID), merchant_request_id: String(provider.MerchantRequestID || ""), amount_kes: budgetKes });
  } catch (error) {
    console.error("[mpesa-ad]", error);
    return json({ error: error instanceof Error ? error.message : "M-Pesa ad payment failed" }, 500);
  }
});
