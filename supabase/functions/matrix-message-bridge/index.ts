import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const bridgeUrl = Deno.env.get("MATRIX_BRIDGE_WEBHOOK_URL") ?? "";
const bridgeSecret = Deno.env.get("MATRIX_BRIDGE_WEBHOOK_SECRET") ?? "";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

Deno.serve(async req => {
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "SUPABASE_CONFIG_MISSING" }, 503);
  if (!bridgeUrl || !bridgeSecret) return json({ ok: false, error: "MATRIX_BRIDGE_NOT_CONFIGURED" }, 503);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: jobs, error } = await db
    .from("communication_delivery_outbox")
    .select("id,message_id,conversation_id,event_name,payload,attempts")
    .eq("provider", "matrix")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!jobs?.length) return json({ ok: true, processed: 0 });

  let processed = 0;
  for (const job of jobs) {
    await db.from("communication_delivery_outbox").update({ status: "processing", attempts: (job.attempts ?? 0) + 1 }).eq("id", job.id).eq("status", "pending");
    try {
      const response = await fetch(bridgeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridgeSecret}` },
        body: JSON.stringify({ source: "testagram", event: job.event_name, message: job.payload }),
      });
      if (!response.ok) throw new Error(`Matrix bridge returned ${response.status}`);
      await db.from("communication_delivery_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
      processed++;
    } catch (bridgeError) {
      const message = bridgeError instanceof Error ? bridgeError.message : String(bridgeError);
      const attempts = (job.attempts ?? 0) + 1;
      await db.from("communication_delivery_outbox").update({
        status: attempts >= 8 ? "failed" : "pending",
        last_error: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** Math.min(attempts, 10) * 1000)).toISOString(),
      }).eq("id", job.id);
    }
  }

  return json({ ok: true, processed, total: jobs.length });
});
