interface Env {
  MEDIA_BUCKET: R2Bucket;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

function keyFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/media/")) return null;
  const key = decodeURIComponent(pathname.slice("/media/".length));
  if (!key || key.length > 512) return null;
  if (!key.startsWith("users/") && !key.startsWith("profiles/")) return null;
  return key;
}

async function redisGet(env: Env, key: string): Promise<string | null> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    const response = await fetch(env.UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.UPSTASH_REDIS_REST_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify(["GET", key]),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { result?: string | null };
    return payload.result ?? null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const url = new URL(request.url);
    const key = keyFromPath(url.pathname);
    if (!key) return new Response("Not found", { status: 404 });

    // Redis is the CDN control-plane cache. A cached route may carry metadata,
    // but R2 remains the source of the actual bytes.
    const cachedRoute = await redisGet(env, "media:route:v1:" + key);
    let objectKey = key;
    if (cachedRoute) {
      try {
        const route = JSON.parse(cachedRoute) as { storage_key?: string };
        if (route.storage_key === key) objectKey = route.storage_key;
      } catch {}
    }

    const object = await env.MEDIA_BUCKET.get(objectKey, {
      range: request.headers,
      onlyIf: request.headers.has("if-none-match")
        ? { etagMatches: request.headers.get("if-none-match")! }
        : undefined,
    });

    if (!object) return new Response("Not found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800");
    headers.set("x-testagram-cdn", "cloudflare");
    headers.set("x-testagram-cache-plane", cachedRoute ? "upstash-hit" : "upstash-miss");

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
