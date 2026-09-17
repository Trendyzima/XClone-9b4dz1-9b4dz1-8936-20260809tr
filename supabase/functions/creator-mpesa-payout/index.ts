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
const DEFAULT_RESULT = `${U}/functions/v1/creator-mpesa-result`;
const RESULT_URL = Deno.env.get("MPESA_CREATOR_B2C_RESULT_URL") || DEFAULT_RESULT;
const TIMEOUT_URL = Deno.env.get("MPESA_CREATOR_B2C_TIMEOUT_URL") || RESULT_URL;
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), {
  status: s,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type" },
});

function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `254${d.slice(1)}`;
  if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) return `254${d}`;
  throw new Error("INVALID_PHONE");
}

async function authenticatedUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization || !A) return null;
  const client = createClient(U, A, { global: { headers: { Authorization: authorization } } });
  return (await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ""))).data.user || null;
}

async function accessToken() {
  const r = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${KEY}:${SECRET}`)}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("MPESA_AUTH_FAILED");
  return String(d.access_token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);

  let payoutId = "";
  try {
    const user = await authenticatedUser(req);
    if (!user) return json({ error: "Authentication required" }, 401);
    if (!BASE || !KEY || !SECRET || !SHORTCODE || !INITIATOR || !SECURITY) {
      return json({ error: "Canonical M-Pesa creator payout is not fully configured." }, 503);
    }

    const body = await req.json();
    payoutId = String(body.payout_id || "");
    if (!payoutId) return json({ error: "payout_id is required" }, 400);

    const { data: payout, error: payoutError } = await admin
      .from("monetization_payouts")
      .select("id,user_id,amount_cents,currency,provider,provider_request_id,provider_payout_id,destination,status,idempotency_key")
      .eq("id", payoutId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (payoutError) throw payoutError;
    if (!payout) return json({ error: "Payout not found" }, 404);
    if (payout.provider !== "mpesa") return json({ error: "Payout provider is not M-Pesa" }, 409);
    if (String(payout.currency).toUpperCase() !== "KES") return json({ error: "M-Pesa creator payouts currently require a KES monetization account" }, 409);
    if (payout.status === "paid") return json({ ok: true, status: "paid", payout_id: payout.id, provider_payout_id: payout.provider_payout_id });
    if (payout.status === "failed") return json({ ok: false, status: "failed", payout_id: payout.id, error: payout.failure_reason || "Payout failed" }, 409);
    if (payout.provider_payout_id) return json({ ok: true, status: payout.status, payout_id: payout.id, provider_payout_id: payout.provider_payout_id }, 202);
    if (payout.status === "processing") return json({ ok: true, status: "processing", payout_id: payout.id, provider_request_id: payout.provider_request_id }, 202);

    const phone = normalizePhone(String(payout.destination?.phone || body.phone || ""));
    const amountKes = Math.floor(Number(payout.amount_cents) / 100);
    if (!Number.isFinite(amountKes) || amountKes < 10 || amountKes > 150000) {
      return json({ error: "Payout amount must be between KES 10 and KES 150,000" }, 400);
    }

    const begun = await admin.rpc("begin_monetization_payout_processing", { p_payout_id: payout.id });
    if (begun.error) throw begun.error;
    if (!begun.data) throw new Error("Unable to begin payout processing");
    if (begun.data.status !== "processing") return json({ ok: true, status: begun.data.status, payout_id: begun.data.id, provider_payout_id: begun.data.provider_payout_id });

    const clientReference = `TP${payout.id.replaceAll("-", "").slice(0, 24)}`;
    const correlated = await admin
      .from("monetization_payouts")
      .update({ provider_request_id: clientReference, destination: { ...(payout.destination || {}), phone } })
      .eq("id", payout.id)
      .eq("status", "processing")
      .is("provider_request_id", null)
      .select("id,provider_request_id")
      .maybeSingle();
    if (correlated.error) throw correlated.error;
    if (!correlated.data) return json({ ok: true, status: "processing", payout_id: payout.id, provider_request_id: clientReference }, 202);

    const access = await accessToken();
    const r = await fetch(`${BASE}/mpesa/b2c/v1/paymentrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        InitiatorName: INITIATOR,
        SecurityCredential: SECURITY,
        CommandID: String(Deno.env.get("MPESA_B2C_COMMAND_ID") || "BusinessPayment"),
        Amount: amountKes,
        PartyA: SHORTCODE,
        PartyB: phone,
        Remarks: `Testagram creator payout ${payout.id}`,
        QueueTimeOutURL: TIMEOUT_URL,
        ResultURL: RESULT_URL,
        Occasion: clientReference,
      }),
    });
    const d = await r.json().catch(() => ({}));
    const providerId = String(d.ConversationID || d.OriginatorConversationID || "");

    if (!r.ok || String(d.ResponseCode) !== "0") {
      await admin.rpc("fail_monetization_payout", {
        p_payout_id: payout.id,
        p_failure_reason: String(d.ResponseDescription || d.errorMessage || "M-Pesa request rejected"),
      });
      return json({ error: d.ResponseDescription || d.errorMessage || "M-Pesa payout request failed" }, 502);
    }

    if (providerId) {
      const updated = await admin
        .from("monetization_payouts")
        .update({ provider_payout_id: providerId })
        .eq("id", payout.id)
        .eq("status", "processing")
        .select("id,status,provider_request_id,provider_payout_id,amount_cents,currency")
        .maybeSingle();
      if (updated.error) throw updated.error;
    }

    return json({ ok: true, status: "processing", payout_id: payout.id, provider_request_id: clientReference, provider_payout_id: providerId || null, amount_kes: amountKes, currency: "KES" }, 202);
  } catch (e) {
    console.error("creator-mpesa-payout", e);
    return json({ error: e instanceof Error ? e.message : "Canonical creator payout failed", payout_id: payoutId || null }, 500);
  }
});
