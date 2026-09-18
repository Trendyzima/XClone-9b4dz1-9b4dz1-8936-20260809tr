import type { VercelRequest, VercelResponse } from "@vercel/node";

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

function response(res: VercelResponse, status: number, body: unknown, cacheable = false) {
  if (cacheable) {
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.setHeader("CDN-Cache-Control", CDN_CACHE_CONTROL);
    res.setHeader("Vercel-CDN-Cache-Control", CDN_CACHE_CONTROL);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return response(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "GET required" } });
  }

  const capability = typeof req.query.capability === "string" ? req.query.capability.trim() : "";
  if (!PUBLIC_CAPABILITIES.has(capability)) {
    return response(res, 400, { ok: false, error: { code: "PUBLIC_CAPABILITY_REQUIRED", message: "Unsupported public capability" } });
  }

  let input: Record<string, unknown> = {};
  const encoded = typeof req.query.input === "string" ? req.query.input : "";
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input must be an object");
      input = parsed as Record<string, unknown>;
    } catch {
      return response(res, 400, { ok: false, error: { code: "INVALID_INPUT", message: "input must be encoded JSON object" } });
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return response(res, 500, { ok: false, error: { code: "SUPABASE_CONFIG_MISSING", message: "Supabase public configuration is missing" } });
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
      return response(res, status, payload ?? {
        ok: false,
        error: { code: "UPSTREAM_FAILURE", message: "Supabase capability gateway failed" },
        request_id: requestId,
      });
    }

    return response(res, 200, payload, true);
  } catch {
    return response(res, 502, {
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", message: "Supabase capability gateway unavailable" },
      request_id: requestId,
    });
  }
}
