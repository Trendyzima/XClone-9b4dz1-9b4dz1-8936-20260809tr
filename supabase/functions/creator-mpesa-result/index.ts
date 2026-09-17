import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const U = Deno.env.get("SUPABASE_URL") || "";
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const r = body?.Result || body?.result || {};
    const code = Number(r.ResultCode ?? r.resultCode);
    const conversation = String(r.ConversationID ?? r.conversationID ?? r.OriginatorConversationID ?? r.originatorConversationID ?? "");
    const txid = String(r.TransactionID ?? r.transactionID ?? "");
    const desc = String(r.ResultDesc ?? r.resultDesc ?? "M-Pesa creator payout result");

    if (!conversation) return json({ ResultCode: 0, ResultDesc: "Accepted" });

    const { data: payout, error } = await admin
      .from("monetization_payouts")
      .select("id,status,provider,provider_payout_id")
      .eq("provider", "mpesa")
      .eq("provider_payout_id", conversation)
      .maybeSingle();
    if (error) throw error;

    // Unknown callbacks are acknowledged so Safaricom does not retry forever.
    // They do not mutate any financial state.
    if (!payout) return json({ ResultCode: 0, ResultDesc: "Accepted" });

    if (Number.isFinite(code) && code === 0) {
      const fin = await admin.rpc("complete_monetization_payout", {
        p_payout_id: payout.id,
        p_provider_payout_id: txid || conversation,
      });
      if (fin.error) throw fin.error;
    } else {
      const fin = await admin.rpc("fail_monetization_payout", {
        p_payout_id: payout.id,
        p_failure_reason: desc,
      });
      if (fin.error) throw fin.error;
    }

    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error("creator-mpesa-result", e);
    return json({ ResultCode: 1, ResultDesc: "Settlement retry required" }, 500);
  }
});
