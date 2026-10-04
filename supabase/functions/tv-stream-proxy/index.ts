import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges,Content-Type",
  "Cache-Control": "no-store",
};

function isBlockedHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal" || h === "metadata.google") return true;
  const parts = h.split(".").map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [a,b] = parts;
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true;
  }
  return false;
}

function resolveUrl(value: string, base: URL) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function proxyUrl(target: string) {
  return new URL("/functions/v1/tv-stream-proxy?url=" + encodeURIComponent(target), "https://ffrhglgkukgsuhxenena.supabase.co").toString();
}

function isBlockedHostname(hostname: string) {
  const h = hostname.toLowerCase().replace(/\\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal" || h === "metadata.google") return true;
  if (h.includes(":")) {
    const compact = h.replace(/^\\[|\\]$/g, "");
    if (compact === "::1" || compact === "::" || compact.startsWith("fc") || compact.startsWith("fd") || compact.startsWith("fe8") || compact.startsWith("fe9") || compact.startsWith("fea") || compact.startsWith("feb")) return true;
    if (compact.startsWith("::ffff:")) return isBlockedHostname(compact.slice(7));
  }
  const parts = h.split(".").map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [a,b] = parts;
    if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    let current = new URL(url);
    let response: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      if (!/^https?:$/.test(current.protocol) || isBlockedHostname(current.hostname)) {
        throw new Error("Blocked stream redirect target");
      }
      response = await fetch(current.toString(), {...init, signal: controller.signal, redirect: "manual"});
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current);
    }
    throw new Error("Too many stream redirects");
  } finally { clearTimeout(timer); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: corsHeaders});
  if (req.method !== "GET") return new Response("Method Not Allowed", {status: 405, headers: corsHeaders});

  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return new Response(JSON.stringify({error:"Missing url"}), {status:400, headers:{...corsHeaders,"Content-Type":"application/json"}});

  let target: URL;
  try { target = new URL(raw); } catch {
    return new Response(JSON.stringify({error:"Invalid url"}), {status:400, headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
  if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname) || isBlockedHostname(target.hostname)) {
    return new Response(JSON.stringify({error:"Blocked stream host"}), {status:403, headers:{...corsHeaders,"Content-Type":"application/json"}});
  }

  const headers = new Headers();
  const range = req.headers.get("range");
  if (range) headers.set("Range", range);
  headers.set("Accept", "*/*");
  headers.set("User-Agent", "TestagramTV/3.1");

  try {
    const upstream = await fetchWithTimeout(target.toString(), {headers}, 9000);
    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({error:"Upstream stream unavailable",status:upstream.status}), {
        status:502, headers:{...corsHeaders,"Content-Type":"application/json"}
      });
    }

    const type = (upstream.headers.get("content-type") || "").toLowerCase();
    const isManifest = /mpegurl|m3u8|application\/vnd\.apple\.mpegurl/.test(type) || /\.m3u8(?:$|[?#])/i.test(target.pathname + target.search);

    if (isManifest) {
      const text = await upstream.text();
      const lines = text.split(/\r?\n/);
      const rewritten = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#EXTM3U") || trimmed.startsWith("#EXTINF") || trimmed.startsWith("#EXT-X-")) {
          const rewrittenAttrs = line.replace(/URI="([^"]+)"/gi, (full, uri) => {
            const resolved = resolveUrl(uri, target);
            return resolved ? `URI="${proxyUrl(resolved)}"` : full;
          });
          return rewrittenAttrs;
        }
        if (trimmed.startsWith("#")) return line;
        const resolved = resolveUrl(trimmed, target);
        return resolved ? proxyUrl(resolved) : line;
      }).join("\n");
      return new Response(rewritten, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "X-Testagram-TV-Proxy": "hls",
        }
      });
    }

    const outHeaders = new Headers(corsHeaders);
    for (const name of ["content-type","content-length","content-range","accept-ranges","etag","last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) outHeaders.set(name, value);
    }
    outHeaders.set("X-Testagram-TV-Proxy", "media");
    return new Response(upstream.body, {status:upstream.status, headers:outHeaders});
  } catch (error) {
    console.error("[tv-stream-proxy]", error);
    return new Response(JSON.stringify({error:"Stream proxy timeout or network failure"}), {
      status:504, headers:{...corsHeaders,"Content-Type":"application/json"}
    });
  }
});
