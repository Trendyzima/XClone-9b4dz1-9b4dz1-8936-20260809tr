interface Env {
  SUPABASE_HEARTBEAT_RPC_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

const SUPPRESSION_SECONDS = 29 * 60 + 55;

const ALLOWED_ORIGINS = new Set([
  "https://testagram.site",
  "https://www.testagram.site",
]);

function json(body: unknown, status = 200, request?: Request, extra: Record<string, string> = {}) {
  const origin = request?.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-headers": "authorization, content-type, x-client-version",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "3600",
    "vary": "Origin",
    "x-testagram-heartbeat": "cloudflare-edge",
    ...extra,
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return json({ ok: true }, 200, request);
    if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405, request);

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Authentication required" }, 401, request);
    }

    const tokenHash = await sha256Hex(authorization.slice(7));
    const cacheKey = new Request(
      `https://heartbeat-cache.testagram.site/__hb/${tokenHash}`,
      { method: "GET" },
    );

    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      return json({ ok: true, suppressed: true }, 200, request, { "x-testagram-heartbeat-cache": "HIT" });
    }

    const upstream = await fetch(env.SUPABASE_HEARTBEAT_RPC_URL, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "apikey": env.SUPABASE_PUBLISHABLE_KEY,
        "x-client-info": "testagram-cloudflare-heartbeat-rpc",
      },
      body: JSON.stringify({
        client_version: request.headers.get("x-client-version")?.slice(0, 40) ?? null,
      }),
    });

    if (upstream.status === 401) {
      return json({ ok: false, error: "Authentication required" }, 401, request, { "x-testagram-heartbeat-cache": "MISS" });
    }

    if (!upstream.ok) {
      return json({ ok: false, error: "Heartbeat unavailable" }, 503, request, { "x-testagram-heartbeat-cache": "MISS" });
    }

    const suppression = new Response(
      JSON.stringify({ ok: true, suppressed: false }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${SUPPRESSION_SECONDS}`,
          "x-testagram-heartbeat": "cloudflare-edge",
          "x-testagram-heartbeat-cache": "MISS",
        },
      },
    );
    ctx.waitUntil(cache.put(cacheKey, suppression.clone()));
    return json({ ok: true, suppressed: false }, 200, request, {
      "cache-control": `no-store`,
      "x-testagram-heartbeat-cache": "MISS",
    });
  },
} satisfies ExportedHandler<Env>;
