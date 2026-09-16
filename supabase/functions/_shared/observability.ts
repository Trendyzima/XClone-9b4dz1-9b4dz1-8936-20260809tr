import { createClient } from "npm:@supabase/supabase-js@2";

export type ServiceStatus = "ok" | "error" | "timeout" | "degraded";

type ServiceMetricArgs = {
  p_service: string;
  p_operation: string;
  p_status: ServiceStatus;
  p_duration_ms: number;
  p_metadata: Record<string, unknown>;
};

/**
 * The Edge Function client is intentionally created without generated Database
 * types. Keep the RPC contract explicit here so Deno type-checking does not
 * erase the argument shape to `undefined` while the runtime still calls the
 * canonical public.record_service_metric function.
 */
const recordServiceMetricRpc = (
  db: ReturnType<typeof createClient>,
  args: ServiceMetricArgs,
) => db.rpc("record_service_metric" as never, args as never);

export function serviceTimer(service: string, operation: string) {
  const started = performance.now();
  return {
    async finish(status: ServiceStatus, metadata: Record<string, unknown> = {}) {
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      console.log(JSON.stringify({ service, operation, status, duration_ms: durationMs, ...metadata }));
      return durationMs;
    },
  };
}

export async function recordServiceMetric(
  db: ReturnType<typeof createClient>,
  service: string,
  operation: string,
  status: ServiceStatus,
  durationMs: number,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await recordServiceMetricRpc(db, {
    p_service: service,
    p_operation: operation,
    p_status: status,
    p_duration_ms: durationMs,
    p_metadata: metadata,
  });
  if (error) console.warn("[observability] metric write failed", error.message);
}

export async function withServiceMetric<T>(
  db: ReturnType<typeof createClient>,
  service: string,
  operation: string,
  work: () => Promise<T>,
  metadata: Record<string, unknown> = {},
): Promise<T> {
  const timer = serviceTimer(service, operation);
  try {
    const result = await work();
    const durationMs = await timer.finish("ok", metadata);
    await recordServiceMetric(db, service, operation, "ok", durationMs, metadata);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: ServiceStatus = /timeout|aborted/i.test(message) ? "timeout" : "error";
    const durationMs = await timer.finish(status, { ...metadata, error: message.slice(0, 300) });
    await recordServiceMetric(db, service, operation, status, durationMs, { ...metadata, error: message.slice(0, 300) });
    throw error;
  }
}
