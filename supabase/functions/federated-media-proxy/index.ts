import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "https://testagram.site",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Range,Accept,Origin",
  "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges,Content-Type,ETag",
};

const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const BLOCKED_TYPES = new Set([
  "text/html",
  "application/json",
  "text/xml",
  "application/xml",
]);

function isPrivateIpv4(host: string) {
  const p = host.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168);
}

function hostAllowed(target: string, source: string) {
  const targetUrl = new URL(target);
  const sourceUrl = new URL(source);
  if (targetUrl.protocol !== "https:" || sourceUrl.protocol !== "https:") return false;
  const th = targetUrl.hostname.toLowerCase();
  const sh = sourceUrl.hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(th) || isPrivateIpv4(th) || th.endsWith(".local") || th.endsWith(".internal")) return false;
  if (PRIVATE_HOSTS.has(sh) || isPrivateIpv4(sh) || sh.endsWith(".local") || sh.endsWith(".internal")) return false;

  // Remote media normally lives on the actor's host or its media/CDN subdomain.
  // Also permit the common separate-media-host pattern sharing the registrable
  // suffix. This keeps the public proxy from becoming an arbitrary URL fetcher.
  const tParts = th.split(".");
  const sParts = sh.split(".");
  const suffix = tParts.length >= 2 && sParts.length >= 2
    ? tParts.slice(-2).join(".") === sParts.slice(-2).join(".")
    : th === sh;

  // Fediverse actors frequently publish media through a different CDN than
  // their actor host. Keep the proxy closed to arbitrary hosts while explicitly
  // supporting major federation/social media CDNs that commonly appear in
  // ActivityPub attachments.
  const trustedMediaHosts = [
    "twimg.com",
    "twitter.com",
    "x.com",
    "pbs.twimg.com",
    "cdninstagram.com",
    "fbcdn.net",
    "fbsbx.com",
    "cloudfront.net",
    "fastly.net",
    "amazonaws.com",
  ];
  const trustedMedia = trustedMediaHosts.some(domain =>
    th === domain || th.endsWith("." + domain)
  );

  return th === sh || th.endsWith("." + sh) || suffix || trustedMedia;
}

function responseHeaders(upstream: Response) {
  const headers = new Headers(CORS);
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  headers.set("Content-Type", contentType);
  for (const name of ["content-length", "content-range", "accept-ranges", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name.replace(/(^|-)([a-z])/g, (_, p, c) => p + c.toUpperCase()), value);
  }
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  return headers;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return new Response("GET required", { status: 405, headers: CORS });

  try {
    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get("url") || "";
    const source = requestUrl.searchParams.get("source") || "";
    if (!target || !source) return new Response("url and source are required", { status: 400, headers: CORS });
    if (!hostAllowed(target, source)) return new Response("Remote media host is not allowed", { status: 403, headers: CORS });

    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*;q=0.9,*/*;q=0.5",
        "User-Agent": "Testagram-Federation-Media/1.0",
        ...(request.headers.get("Range") ? { Range: request.headers.get("Range")! } : {}),
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return new Response("Remote media unavailable", {
        status: upstream.status === 404 ? 404 : 502,
        headers: CORS,
      });
    }

    const type = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (BLOCKED_TYPES.has(type) || (!type.startsWith("image/") && !type.startsWith("video/") && !type.startsWith("audio/"))) {
      return new Response("Remote resource is not media", { status: 415, headers: CORS });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream),
    });
  } catch (error) {
    console.error("federated-media-proxy", error);
    return new Response("Media proxy failed", { status: 502, headers: CORS });
  }
});
