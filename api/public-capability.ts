export const config = { runtime: "edge" };

const PUBLIC_CAPABILITIES = new Set([
  "testagram.search.users",
  "testagram.search.posts",
  "testagram.search.hashtags",
  "testagram.search.communities",
  "testagram.trends.list",
  "testagram.profile.timeline",
]);

const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
const CDN_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

function json(body: unknown, status = 200, cacheable = false) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (cacheable) {
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set("CDN-Cache-Control", CDN_CACHE_CONTROL);
    headers.set("Vercel-CDN-Cache-Control", CDN_CACHE_CONTROL);
  } else {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function handler(request: Request) {
  if (request.method !== "GET") {
    return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "GET required" } }, 405);
  }

  const url = new URL(request.url);
  const capability = url.searchParams.get("capability")?.trim() ?? "";
  if (!PUBLIC_CAPABILITIES.has(capability)) {
    return json({ ok: false, error: { code: "PUBLIC_CAPABILITY_REQUIRED", message: "Unsupported public capability" } }, 400);
  }

  let input: Record<string, unknown> = {};
  const encoded = url.searchParams.get("input") ?? "";
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input must be an object");
      input = parsed as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: { code: "INVALID_INPUT", message: "input must be encoded JSON object" } }, 400);
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: { code: "SUPABASE_CONFIG_MISSING", message: "Supabase public configuration is missing" } }, 500);
  }

  const gatewayUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/capability-gateway`;
  const requestId = crypto.randomUUID();

  try {
    const upstream = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Request-Id": requestId,
        "X-Testagram-Client": "vercel-public-edge",
        "X-Testagram-Client-Version": "1",
      },
      body: JSON.stringify({ capability, input }),
    });

    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || !payload?.ok) {
      const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
      return json(payload ?? {
        ok: false,
        error: { code: "UPSTREAM_FAILURE", message: "Supabase capability gateway failed" },
        request_id: requestId,
      }, status);
    }

    return json(payload, 200, true);
  } catch {
    return json({
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", message: "Supabase capability gateway unavailable" },
      request_id: requestId,
    }, 502);
  }
}
