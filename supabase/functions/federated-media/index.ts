import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  "";
const BUCKET = "federated-media";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const storage = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function redirectTo(url: string) {
  return new Response(null, {
    status: 302,
    headers: { ...CORS, "Location": url, "Cache-Control": "public, max-age=86400" },
  });
}

function publicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv6(value: string): boolean {
  const ip = value.toLowerCase().split("%")[0];
  if (ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
      ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") ||
      ip.startsWith("feb") || ip.startsWith("ff") || ip.startsWith("2001:db8:")) return false;
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    if (mapped.includes(".")) return publicIpv4(mapped);
    return false;
  }
  return ip.includes(":");
}

async function validateRemoteUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid media URL");
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || !url.hostname) {
    throw new Error("Only public HTTPS media URLs are supported");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") ||
      host.endsWith(".test") || host.endsWith(".invalid") ||
      host.endsWith(".example") || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":")) {
    throw new Error("Private or literal-IP media hosts are not allowed");
  }
  const answers = await Promise.allSettled([
    Deno.resolveDns(host, "A"),
    Deno.resolveDns(host, "AAAA"),
  ]);
  const addresses = answers.flatMap((answer) =>
    answer.status === "fulfilled" ? answer.value : []
  );
  if (!addresses.length) throw new Error("Media host could not be resolved");
  for (const address of addresses) {
    const safe = address.includes(":") ? publicIpv6(address) : publicIpv4(address);
    if (!safe) throw new Error("Media host resolved to a non-public address");
  }
  return url;
}

function allowedContentType(value: string | null): string | null {
  const type = (value ?? "").split(";")[0].trim().toLowerCase();
  const allowed = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
    "video/mp4", "video/webm", "video/quicktime",
    "audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav", "audio/webm",
  ]);
  if (type === "image/jpg") return "image/jpeg";
  return allowed.has(type) ? type : null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new Error("Media exceeds the 20 MB cache limit");
  if (!response.body) throw new Error("Remote media response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("Media exceeds the 20 MB cache limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed" }, 405);
  const input = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  if (!input) return json({ error: "url is required" }, 400);
  try {
    let source = await validateRemoteUrl(input);
    const original = source.toString();
    const key = await sha256(original);
    const objectPath = `${key.slice(0, 2)}/${key}`;
    const cached = await storage.from(BUCKET).list(key.slice(0, 2), { search: key, limit: 1 });
    if (!cached.error && cached.data?.some((item) => item.name === key)) {
      const url = storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
      return redirectTo(url);
    }

    let upstream: Response | null = null;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      upstream = await fetch(source, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
        headers: { "Accept": "image/avif,image/webp,image/*,video/*,audio/*;q=0.9,*/*;q=0.1", "User-Agent": "Testagram-Federated-Media/1.0" },
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("Too many media redirects");
      source = await validateRemoteUrl(new URL(location, source).toString());
    }
    if (!upstream || !upstream.ok) {
      return json({ error: `Remote media returned HTTP ${upstream?.status ?? 502}` }, 502);
    }
    const contentType = allowedContentType(upstream.headers.get("content-type"));
    if (!contentType) return json({ error: "Unsupported or unsafe media type" }, 415);
    const bytes = await readBounded(upstream);
    const saved = await storage.from(BUCKET).upload(objectPath, bytes, {
      contentType,
      cacheControl: "31536000",
      upsert: true,
    });
    if (saved.error) {
      console.error("federated media cache write failed", saved.error.message);
      return json({ error: "Media could not be cached" }, 502);
    }
    const localUrl = storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
    return redirectTo(localUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media proxy failed";
    const status = /invalid media URL|only public HTTPS|not allowed|resolved to a non-public|could not be resolved/i.test(message) ? 400 : 502;
    return json({ error: message }, status);
  }
});
