import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const novuApiKey = Deno.env.get("NOVU_API_KEY") ?? "";
const novuWorkflowId = Deno.env.get("NOVU_NOTIFICATION_WORKFLOW_ID") ?? "";
const novuApiUrl = (Deno.env.get("NOVU_API_URL") ?? "https://api.novu.co").replace(/\/$/, "");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Supabase service configuration is missing" }, 500);
  if (!novuApiKey || !novuWorkflowId) return json({ ok: false, error: "Novu delivery is not configured" }, 503);

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ ok: false, error: "Bearer authentication required" }, 401);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const batchSize = Math.min(50, Math.max(1, Number(req.headers.get("x-batch-size") ?? "20")));

  const { data: rows, error: claimError } = await db.rpc("claim_notification_delivery_batch", { p_limit: batchSize });
  if (claimError) return json({ ok: false, error: claimError.message }, 500);

  const claimed = Array.isArray(rows) ? rows : [];
  let sent = 0;
  let failed = 0;

  for (const row of claimed) {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    const idempotencyKey = `testagram-notification-${row.notification_id}`;
    try {
      const response = await fetch(`${novuApiUrl}/v1/events/trigger`, {
        method: "POST",
        headers: {
          Authorization: `ApiKey ${novuApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          name: novuWorkflowId,
          to: [{ subscriberId: row.recipient_id }],
          payload: { ...payload, source: "testagram", notificationId: row.notification_id },
        }),
      });

      if (!response.ok) {
        const text = (await response.text()).slice(0, 500);
        throw new Error(`Novu ${response.status}: ${text}`);
      }

      await db.rpc("complete_notification_delivery", { p_id: row.id });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.rpc("fail_notification_delivery", { p_id: row.id, p_error: message.slice(0, 500) });
      failed += 1;
    }
  }

  return json({ ok: true, claimed: claimed.length, sent, failed });
});
