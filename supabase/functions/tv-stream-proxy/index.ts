import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROXY_ENDPOINT = "https://ffrhglgkukgsuhxenena.supabase.co/functions/v1/tv-stream-proxy";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Range, Origin, Accept, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

const blockedHost = (host: string) => {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (h.startsWith("172.")) {
    const n = Number(h.split(".")[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  return false;
};

const proxyUrl = (base: string, target: string) =>
  base + "?url=" + encodeURIComponent(target);

function rewriteManifest(text: string, sourceUrl: string, base: string) {
  const absolute = (value: string) => {
    try {
      return new URL(value, sourceUrl).toString();
    } catch {
      return "";
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
          const u = absolute(uri);
          return u ? 'URI="' + proxyUrl(base, u) + '"' : 'URI="' + uri + '"';
        });
      }
      const u = absolute(line.trim());
      return u ? proxyUrl(base, u) : line;
    })
    .join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("GET required", { status: 405, headers: cors });
  }

  const raw = new URL(req.url).searchParams.get("url") || "";
  let target: URL;
  try { target = new URL(raw); } catch {
    return new Response("Invalid stream URL", { status: 400, headers: cors });
  }
  if (!["http:", "https:"].includes(target.protocol) || blockedHost(target.hostname)) {
    return new Response("Stream host is not allowed", { status: 403, headers: cors });
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: {
        Accept: req.headers.get("accept") || "*/*",
        Range: req.headers.get("range") || "",
        "User-Agent": "TestagramTV/1.0",
      },
      redirect: "follow",
    });

    const type = upstream.headers.get("content-type") || "";
    const isManifest =
      type.includes("mpegurl") ||
      type.includes("application/x-mpegURL") ||
      target.pathname.toLowerCase().endsWith(".m3u8");

    if (isManifest && upstream.body) {
      const text = await upstream.text();
      const rewritten = rewriteManifest(text, target.toString(), PROXY_ENDPOINT);
      return new Response(req.method === "HEAD" ? null : rewritten, {
        status: upstream.status,
        headers: {
          ...cors,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        ...cors,
        "Content-Type": type || "application/octet-stream",
        "Cache-Control": "no-store",
        "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
        "Content-Length": upstream.headers.get("content-length") || "",
        "Content-Range": upstream.headers.get("content-range") || "",
      },
    });
  } catch (error) {
    console.error("[tv-stream-proxy]", error);
    return new Response("Upstream stream unavailable", { status: 502, headers: cors });
  }
});
