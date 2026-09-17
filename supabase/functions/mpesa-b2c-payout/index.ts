import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const U = Deno.env.get("SUPABASE_URL") || "";
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const A = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const ENV = (Deno.env.get("MPESA_ENV") || "").toLowerCase();
const BASE = ENV === "sandbox" ? "https://sandbox.safaricom.co.ke" : ENV === "live" ? "https://api.safaricom.co.ke" : "";
const KEY = Deno.env.get("MPESA_CONSUMER_KEY") || "";
const SECRET = Deno.env.get("MPESA_CONSUMER_SECRET") || "";
const SHORTCODE = Deno.env.get("MPESA_SHORTCODE") || "";
const INITIATOR = Deno.env.get("MPESA_B2C_INITIATOR") || Deno.env.get("MPESA_INITIATOR_NAME") || "";
const SECURITY = Deno.env.get("MPESA_SECURITY_CREDENTIAL") || Deno.env.get("MPESA_SECURITY_CRED") || "";
const RATE = Number(Deno.env.get("MPESA_USD_KES_RATE") || "");
const RESULT_URL = Deno.env.get("MPESA_B2C_RESULT_URL") || `${U}/functions/v1/mpesa-b2c-result`;
const TIMEOUT_URL = Deno.env.get("MPESA_B2C_TIMEOUT_URL") || RESULT_URL;
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" },
});

function phone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `254${d.slice(1)}`;
  if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) return `254${d}`;
  throw new Error("INVALID_PHONE");
}

async function user(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization || !A) return null;
  const client = createClient(U, A, { global: { headers: { Authorization: authorization } } });
  return (await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ""))).data.user || null;
}

async function token() {
  const response = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${KEY}:${SECRET}`)}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error("MPESA_AUTH_FAILED");
  return String(data.access_token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);
  try {
    const u = await user(req);
    if (!u) return json({ error: "Authentication required" }, 401);
    if (!BASE || !KEY || !SECRET || !SHORTCODE || !INITIATOR || !SECURITY) return json({ error: "M-Pesa B2C is not fully configured." }, 503);

    const body = await req.json().catch(() => ({}));
    const walletId = String(body.wallet_id || "");
    const walletQuery = walletId
      ? admin.from("wallets").select("id,user_id,currency,balance,status,withdrawals_enabled").eq("id", walletId).eq("user_id", u.id).maybeSingle()
      : admin.from("wallets").select("id,user_id,currency,balance,status,withdrawals_enabled").eq("user_id", u.id).maybeSingle();
    const { data: wallet, error: walletError } = await walletQuery;
    if (walletError || !wallet) return json({ error: "Wallet not found" }, 404);
    if (wallet.status !== "active" || wallet.withdrawals_enabled === false) return json({ error: "Withdrawals are disabled for this wallet." }, 403);

    const requestedPhone = phone(String(body.phone || ""));
    const { data: identity, error: identityError } = await admin.from("wallet_phone_identities").select("phone_e164,verified_at").eq("wallet_id", wallet.id).eq("user_id", u.id).maybeSingle();
    if (identityError) return json({ error: "Unable to verify payout destination." }, 500);
    if (!identity?.verified_at || identity.phone_e164 !== requestedPhone) return json({ error: "Verify this M-Pesa number in Wallet Security before withdrawing." }, 403);

    const walletCurrency = String(body.currency || wallet.currency || "USD").toUpperCase();
    if (walletCurrency !== String(wallet.currency || "USD").toUpperCase()) return json({ error: "Wallet currency mismatch" }, 400);
    const hasExplicitKes = body.amount_kes != null;
    const amountKes = Math.floor(Number(body.amount_kes ?? body.amount));
    if (!Number.isFinite(amountKes) || amountKes < 10 || amountKes > 150000) return json({ error: "Invalid withdrawal amount. M-Pesa withdrawals must be between KES 10 and KES 150,000." }, 400);

    let walletAmount: number;
    if (hasExplicitKes) walletAmount = Number(body.amount);
    else if (walletCurrency === "KES") walletAmount = amountKes;
    else {
      if (!Number.isFinite(RATE) || RATE <= 0) return json({ error: "M-Pesa USD/KES exchange rate is not configured." }, 503);
      walletAmount = Number((amountKes / RATE).toFixed(2));
    }
    if (!Number.isFinite(walletAmount) || walletAmount <= 0) return json({ error: "Invalid wallet withdrawal amount" }, 400);

    const reference = `WD${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
    const reserved = await admin.rpc("reserve_mpesa_withdrawal", { p_user_id: u.id, p_wallet_id: wallet.id, p_amount: Number(walletAmount.toFixed(2)), p_currency: walletCurrency, p_phone: requestedPhone, p_amount_kes: amountKes, p_client_reference: reference });
    if (reserved.error || !reserved.data?.ok) {
      const message = reserved.error?.message || "Withdrawal reservation failed";
      return json({ error: message.includes("insufficient_balance") ? "Insufficient balance" : message }, 409);
    }

    try {
      const access = await token();
      const response = await fetch(`${BASE}/mpesa/b2c/v1/paymentrequest`, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ InitiatorName: INITIATOR, SecurityCredential: SECURITY, CommandID: String(Deno.env.get("MPESA_B2C_COMMAND_ID") || "BusinessPayment"), Amount: amountKes, PartyA: SHORTCODE, PartyB: requestedPhone, Remarks: `Testagram withdrawal ${reference}`, QueueTimeOutURL: TIMEOUT_URL, ResultURL: RESULT_URL, Occasion: reference }) });
      const provider = await response.json().catch(() => ({}));
      if (!response.ok || String(provider.ResponseCode) !== "0") {
        await admin.rpc("finalize_mpesa_withdrawal", { p_client_reference: reference, p_provider_order_id: String(provider.ConversationID || provider.OriginatorConversationID || ""), p_result_code: Number(provider.ResponseCode || 1), p_transaction_id: null, p_result_description: String(provider.ResponseDescription || provider.errorMessage || "B2C request rejected"), p_result_data: provider });
        return json({ error: provider.ResponseDescription || provider.errorMessage || "M-Pesa withdrawal request failed" }, 502);
      }
      const providerId = String(provider.ConversationID || provider.OriginatorConversationID || "");
      await admin.from("wallet_transactions").update({ provider_order_id: providerId, provider_status: "PROCESSING", metadata: { client_reference: reference, amount_kes: amountKes, phone: requestedPhone, b2c_response: provider } }).eq("provider_reference", reference).eq("user_id", u.id).eq("status", "pending");
      await admin.from("wallets").update({ mpesa_phone: requestedPhone }).eq("id", wallet.id).eq("user_id", u.id);
      return json({ ok: true, status: "pending", client_reference: reference, provider_order_id: providerId, amount_kes: amountKes, wallet_amount: walletAmount, currency: walletCurrency });
    } catch (error) {
      await admin.rpc("finalize_mpesa_withdrawal", { p_client_reference: reference, p_provider_order_id: null, p_result_code: 1, p_transaction_id: null, p_result_description: "Provider request failed before acceptance", p_result_data: {} });
      throw error;
    }
  } catch (error) {
    console.error("mpesa-b2c-payout", error);
    return json({ error: error instanceof Error ? error.message : "M-Pesa withdrawal failed" }, 500);
  }
});