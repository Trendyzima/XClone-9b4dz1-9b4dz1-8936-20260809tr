import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");

const json = (body: unknown, status = 200, requestId = crypto.randomUUID()) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-request-id, x-client-info, x-testagram-client, x-testagram-client-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "X-Request-Id": requestId,
  },
});

const fail = (requestId: string, code: string, message: string, status: number) =>
  json({ ok: false, data: null, error: { code, message }, request_id: requestId }, status, requestId);

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  if (req.method === "OPTIONS") return json({ ok: true, request_id: requestId }, 200, requestId);
  if (req.method !== "POST") return fail(requestId, "METHOD_NOT_ALLOWED", "POST required", 405);

  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return fail(requestId, "AUTH_REQUIRED", "Bearer authentication required", 401);
  }

  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: { capability?: unknown; input?: unknown };
  try {
    payload = await req.json();
  } catch {
    return fail(requestId, "INVALID_JSON", "Request body must be JSON", 400);
  }

  const capability = typeof payload.capability === "string" ? payload.capability.trim() : "";
  if (!capability) return fail(requestId, "CAPABILITY_REQUIRED", "Capability is required", 400);

  const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
    ? payload.input as Record<string, unknown>
    : {};

  const started = performance.now();
  try {
    const { data: userResult, error: userError } = await db.auth.getUser();
    if (userError || !userResult.user) return fail(requestId, "AUTH_REQUIRED", "Authentication required", 401);

    const { data, error } = await db.rpc("capability_dispatch", {
      p_capability: capability,
      p_input: input,
    });

    if (error) {
      const message = error.message || "Capability execution failed";
      const status = /AUTH_REQUIRED/i.test(message) ? 401 : /REQUIRED|INVALID|NOT_IMPLEMENTED/i.test(message) ? 400 : 500;
      return fail(requestId, status === 500 ? "CAPABILITY_EXECUTION_FAILED" : message, message.slice(0, 300), status);
    }

    const durationMs = Math.round(performance.now() - started);
    await db.rpc("record_service_metric", {
      p_service: "capability-gateway",
      p_operation: capability,
      p_status: "ok",
      p_duration_ms: durationMs,
      p_metadata: { capability, request_id: requestId },
    }).catch(() => undefined);

    return json({ ok: true, data: data ?? {}, error: null, request_id: requestId }, 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Math.round(performance.now() - started);
    await db.rpc("record_service_metric", {
      p_service: "capability-gateway",
      p_operation: capability,
      p_status: "error",
      p_duration_ms: durationMs,
      p_metadata: { capability, request_id: requestId, error: message.slice(0, 200) },
    }).catch(() => undefined);
    return fail(requestId, "CAPABILITY_EXECUTION_FAILED", message.slice(0, 300), 500);
  }
});
