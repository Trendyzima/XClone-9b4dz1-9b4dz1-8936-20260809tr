function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  }
  const token = Deno.env.get("REPLICATION_PROJECTOR_TOKEN") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  if (token.length < 32 || !constantTimeEqual(authorization, "Bearer " + token)) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl.startsWith("https://") || serviceKey.length < 20) {
    return jsonResponse(503, { error: "projector_not_configured" });
  }
  let limit = 25;
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("limit");
    if (raw !== null) {
      if (!/^\d+$/.test(raw)) return jsonResponse(400, { error: "invalid_limit" });
      limit = Number(raw);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return jsonResponse(400, { error: "invalid_limit" });
      }
    }
  } catch {
    return jsonResponse(400, { error: "invalid_request" });
  }
  try {
    const response = await fetch(supabaseUrl + "/rest/v1/rpc/apply_platform_replication_pending", {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: "Bearer " + serviceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_limit: limit }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return jsonResponse(503, { error: "projector_storage_unavailable" });
    const count = await response.json().catch(() => null);
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > limit) {
      return jsonResponse(503, { error: "invalid_projector_result" });
    }
    return jsonResponse(200, { processed: count });
  } catch {
    return jsonResponse(503, { error: "projector_storage_unavailable" });
  }
});
