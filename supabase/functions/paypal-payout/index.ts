import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const CLIENT = Deno.env.get("PAYPAL_CLIENT_ID") || "";
const SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET") || "";
const ENV = (Deno.env.get("PAYPAL_ENV") || "").toLowerCase();
const BASE = ENV === "live" ? "https://api-m.paypal.com" : ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "";
const CORS = { ...corsHeaders, "Access-Control-Allow-Methods": "POST,OPTIONS" };
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function token() {
  if (!BASE || !CLIENT || !SECRET) throw new Error("PAYPAL_CONFIGURATION_INVALID");
  const r = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${CLIENT}:${SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const p = await r.json().catch(() => ({}));
  if (!r.ok || !p.access_token) throw new Error("PAYPAL_AUTH_FAILED");
  return String(p.access_token);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("Authorization") || ""; const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt || !ANON) return json({ error: "Authentication required" }, 401);
    const client = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await client.auth.getUser(jwt);
    if (!user) return json({ error: "Invalid authentication" }, 401);
    const b = await req.json().catch(() => ({}));
    const amount = Number(b.amount); const currency = String(b.currency || "USD").toUpperCase();
    const receiver = String(b.receiver || b.paypal_email || "").trim().toLowerCase();
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return json({ error: "Enter an amount between 1 and 100,000." }, 400);
    if (currency !== "USD") return json({ error: "PayPal payouts currently support USD only." }, 400);
    if (!receiver || receiver.length > 254 || !/^\S+@\S+\.\S+$/.test(receiver)) return json({ error: "A valid PayPal email is required." }, 400);
    if (!BASE || !CLIENT || !SECRET) return json({ error: "PayPal payouts are not configured." }, 503);

    const { data: wallet, error: walletError } = await admin.rpc("ensure_user_wallet", { p_user_id: user.id, p_currency: currency });
    if (walletError || !wallet?.id) return json({ error: "Wallet provisioning failed" }, 500);
    if (wallet.status !== "active" || wallet.spending_enabled === false) return json({ error: "Wallet is unavailable for payouts." }, 403);

    const reference = `PP-${crypto.randomUUID()}`;
    const reserve = await admin.rpc("reserve_external_withdrawal", { p_user_id: user.id, p_wallet_id: wallet.id, p_amount: Number(amount.toFixed(2)), p_currency: currency, p_provider: "paypal", p_provider_reference: reference, p_destination: receiver });
    if (reserve.error || !reserve.data?.id) return json({ error: reserve.error?.message || "Unable to reserve wallet funds" }, 409);
    const txId = reserve.data.id;
    const batchId = reference;
    try {
      const access = await token();
      const response = await fetch(`${BASE}/v1/payments/payouts`, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "PayPal-Request-Id": batchId, Prefer: "return=representation" }, body: JSON.stringify({ sender_batch_header: { sender_batch_id: batchId, email_subject: "You received a Testagram payout" }, items: [{ recipient_type: "EMAIL", receiver, amount: { value: amount.toFixed(2), currency }, note: String(b.note || "Testagram wallet payout").slice(0, 1000), sender_item_id: txId }] }) });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok || !raw?.batch_header?.payout_batch_id) {
        await admin.rpc("finalize_external_withdrawal", { p_transaction_id: txId, p_success: false, p_provider_order_id: null, p_provider_status: `REJECTED_${response.status}`, p_provider_data: raw });
        return json({ error: "PayPal payout was rejected", detail: raw?.message || raw?.name || "Provider rejected payout" }, 502);
      }
      const batch = raw.batch_header; const status = String(batch.batch_status || "PENDING").toUpperCase();
      await admin.rpc("mark_external_withdrawal_processing", { p_transaction_id: txId, p_provider_order_id: String(batch.payout_batch_id), p_provider_status: status, p_provider_data: raw });
      return json({ ok: true, transactionId: txId, payoutBatchId: String(batch.payout_batch_id), status });
    } catch (e) {
      await admin.rpc("finalize_external_withdrawal", { p_transaction_id: txId, p_success: false, p_provider_order_id: null, p_provider_status: "REQUEST_ERROR", p_provider_data: { error: e instanceof Error ? e.message : "unknown" } });
      return json({ error: "PayPal payout request failed" }, 502);
    }
  } catch (e) { console.error("paypal-payout", e); return json({ error: "PayPal payout failed" }, 500); }
});
