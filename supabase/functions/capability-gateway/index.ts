import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { redisGetJson, redisIncrWithExpiry, redisSetJson } from "../_shared/upstash-redis.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? (() => {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!raw) return "";
  try { const parsed = JSON.parse(raw); return typeof parsed === "string" ? parsed : Object.values(parsed ?? {})[0] ?? ""; } catch { return ""; }
})();
if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");

const json = (body: unknown, status = 200, requestId = crypto.randomUUID(), cacheControl = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-request-id, x-client-info, x-testagram-client, x-testagram-client-version",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "X-Request-Id": requestId,
    },
  });

// Keep this allowlist aligned with capability_registry.access='public'.
// Read-only does not mean public: search, trends and profile timeline are authenticated.
const PUBLIC_CAPABILITIES = new Set([
  "testagram.capabilities.list",
  "testagram.health.read",
  "testagram.search.users",
  "testagram.search.posts",
  "testagram.search.hashtags",
  "testagram.search.communities",
  "testagram.trends.list",
  "testagram.profile.timeline",
  "testagram.news.trending",
]);

const SUCCESS_METRIC_SAMPLE_RATE = 0.01;
const shouldSampleSuccess = () => crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff < SUCCESS_METRIC_SAMPLE_RATE;

const recordMetric = async (
  db: ReturnType<typeof createClient>,
  capability: string,
  status: "ok" | "error",
  durationMs: number,
  requestId: string,
  error?: string,
) => {
  if (status === "ok" && !shouldSampleSuccess()) return;
  await db.rpc("record_service_metric", {
    p_service: "capability-gateway",
    p_operation: capability,
    p_status: status,
    p_duration_ms: durationMs,
    p_metadata: {
      capability,
      request_id: requestId,
      ...(error ? { error: error.slice(0, 200) } : {}),
      ...(status === "ok" ? { sampled: true } : {}),
    },
  }).catch(() => undefined);
};

const rateLimit = async (req: Request, capability: string, subject: string, limit: number) => {
  const windowSeconds = 60;
  const key = `testagram:ratelimit:gateway:${capability}:${subject}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const count = await redisIncrWithExpiry(key, windowSeconds + 2);
  if (count === null) return null;
  return { allowed: count <= limit, count, limit, retryAfter: windowSeconds };
};

const fail = (requestId: string, code: string, message: string, status: number) =>
  json({ ok: false, data: null, error: { code, message }, request_id: requestId }, status, requestId);

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  if (req.method === "OPTIONS") return json({ ok: true, request_id: requestId }, 200, requestId);
  if (req.method !== "POST") return fail(requestId, "METHOD_NOT_ALLOWED", "POST required", 405);

  const authorization = req.headers.get("authorization");

  let payload: { capability?: unknown; input?: unknown };
  try {
    payload = await req.json();
  } catch {
    return fail(requestId, "INVALID_JSON", "Request body must be JSON", 400);
  }

  const capability = typeof payload.capability === "string" ? payload.capability.trim() : "";
  if (!capability) return fail(requestId, "CAPABILITY_REQUIRED", "Capability is required", 400);

  const isPublicCapability = PUBLIC_CAPABILITIES.has(capability);
  if (!isPublicCapability && !authorization?.startsWith("Bearer ")) {
    return fail(requestId, "AUTH_REQUIRED", "Bearer authentication required", 401);
  }

  const db = createClient(url, anonKey, {
    global: authorization?.startsWith("Bearer ") ? { headers: { Authorization: authorization } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
    ? payload.input as Record<string, unknown>
    : {};

  const started = performance.now();

  try {
    let rateLimitSubject = req.headers.get("cf-connecting-ip")?.trim()
      || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "anonymous";
    let rateLimitLimit = isPublicCapability ? 120 : 300;

    if (!isPublicCapability) {
      const { data: userResult, error: userError } = await db.auth.getUser();
      if (userError || !userResult.user) return fail(requestId, "AUTH_REQUIRED", "Authentication required", 401);
      rateLimitSubject = userResult.user.id;
    }

    const rate = await rateLimit(req, capability, rateLimitSubject, rateLimitLimit);
    if (rate && !rate.allowed) {
      const response = fail(requestId, "RATE_LIMITED", "Too many requests; retry shortly.", 429);
      response.headers.set("Retry-After", String(rate.retryAfter));
      response.headers.set("X-RateLimit-Limit", String(rate.limit));
      response.headers.set("X-RateLimit-Remaining", "0");
      return response;
    }

    if (capability === "testagram.news.trending") {
      const limit = typeof input.limit === "number" ? Math.min(50, Math.max(1, Math.floor(input.limit))) : 20;
      const geo = typeof input.geo === "string" ? input.geo.trim().toUpperCase() : "US";
      const language = typeof input.language === "string" ? input.language.trim() : "english";
      const cacheKey = `testagram:newsify:trending:${geo}:${language}:${limit}`;
      const cached = await redisGetJson<{ items?: unknown[]; geo?: string; language?: string }>(cacheKey);
      if (cached) {
        await recordMetric(db, capability, "ok", Math.round(performance.now() - started), requestId);
        return json({ ok: true, data: cached, error: null, request_id: requestId }, 200, requestId, "public,max-age=30,stale-while-revalidate=120");
      }
      const { data, error } = await db.rpc("list_newsify_trending", {
        p_limit: limit,
        p_geo: geo,
        p_language: language,
      });
      if (error) {
        const message = error.message || "Newsify trend query failed";
        await recordMetric(db, capability, "error", Math.round(performance.now() - started), requestId, message);
        return fail(requestId, "NEWSIFY_TREND_QUERY_FAILED", message.slice(0, 300), 500);
      }
      const dataPayload = data ?? { items: [], geo, language };
      await redisSetJson(cacheKey, dataPayload, 30);
      await recordMetric(db, capability, "ok", Math.round(performance.now() - started), requestId);
      return json({ ok: true, data: dataPayload, error: null, request_id: requestId }, 200, requestId, "public,max-age=30,stale-while-revalidate=120");
    }

    const rpcName = capability === "testagram.profile.update" ? "profile_update" : "capability_dispatch";
    const rpcArgs = capability === "testagram.profile.update"
      ? { p_input: input }
      : { p_capability: capability, p_input: input };
    const { data, error } = await db.rpc(rpcName, rpcArgs);

    if (error) {
      const message = error.message || "Capability execution failed";
      const status = /AUTH_REQUIRED/i.test(message) ? 401 : /REQUIRED|INVALID|NOT_IMPLEMENTED/i.test(message) ? 400 : 500;
      await recordMetric(db, capability, "error", Math.round(performance.now() - started), requestId, message);
      return fail(requestId, status === 500 ? "CAPABILITY_EXECUTION_FAILED" : message, message.slice(0, 300), status);
    }

    const durationMs = Math.round(performance.now() - started);
    await recordMetric(db, capability, "ok", durationMs, requestId);

    return json({ ok: true, data: data ?? {}, error: null, request_id: requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Math.round(performance.now() - started);
    await recordMetric(db, capability, "error", durationMs, requestId, message);
    return fail(requestId, "CAPABILITY_EXECUTION_FAILED", message.slice(0, 300), 500);
  }
});