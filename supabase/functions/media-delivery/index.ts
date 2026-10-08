import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
async function redisConfig(): Promise<{url:string;token:string}|null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: urlData }, { data: tokenData }] = await Promise.all([
      db.rpc("get_secret_for_worker", { secret_name: "upstash_redis_rest_url" }),
      db.rpc("get_secret_for_worker", { secret_name: "upstash_redis_rest_token" }),
    ]);
    const url = typeof urlData === "string" ? urlData.replace(/\/$/, "") : "";
    const token = typeof tokenData === "string" ? tokenData : "";
    return url && token ? { url, token } : null;
  } catch { return null; }
}
async function redisCommand<T>(args: string[]): Promise<T|null> {
  const config = await redisConfig();
  if (!config) return null;
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { result?: T };
    return payload.result ?? null;
  } catch { return null; }
}
async function redisGetJson<T>(key: string): Promise<T|null> {
  const raw = await redisCommand<string>(["GET", key]);
  if (typeof raw !== "string" || !raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
async function redisSetJson(key: string, value: unknown, ttlSeconds: number) {
  return (await redisCommand<string>(["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)])) === "OK";
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const R2_PUBLIC_BASE_URL = (Deno.env.get("R2_PUBLIC_BASE_URL") ?? "").replace(/\/$/, "");

type MediaRoute = { url: string; media_type: string; mime_type: string; byte_size: number };
const db = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

function response(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function redirectLocation(key: string) {
  return R2_PUBLIC_BASE_URL + "/" + key;
}
function validKey(key: string) {
  return key.length > 0 && key.length <= 512 && (key.startsWith("users/") || key.startsWith("profiles/"));
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return response("Method not allowed", 405, { Allow: "GET, HEAD" });
  const requestUrl = new URL(req.url);
  // Accept both the current query contract and the legacy path contract.
  // Older media rows were written as /media-delivery/users/... while this
  // function originally only parsed ?key=..., producing deterministic 400s.
  const queryKey = requestUrl.searchParams.get("key")?.trim() ?? "";
  const functionPrefix = "/functions/v1/media-delivery/";
  const pathKey = requestUrl.pathname.startsWith(functionPrefix)
    ? decodeURIComponent(requestUrl.pathname.slice(functionPrefix.length)).trim()
    : "";
  const key = queryKey || pathKey;
  if (!validKey(key)) return response("Invalid media key", 400);
  if (!R2_PUBLIC_BASE_URL || !db) return response("Media delivery is not configured", 503);

  const cacheKey = "media:route:v1:" + key;
  let route = await redisGetJson<MediaRoute>(cacheKey);

  if (!route) {
    const { data, error } = await db.from("media_assets")
      .select("storage_key,media_type,mime_type,byte_size,status")
      .eq("storage_key", key).eq("status", "uploaded").maybeSingle();
    if (error) {
      console.error("[media-delivery] metadata lookup failed", error.message);
      return response("Media metadata unavailable", 503);
    }
    const isProfile = key.startsWith("profiles/");
    if (!data && !isProfile) return response("Media not found", 404);
    route = {
      url: R2_PUBLIC_BASE_URL + "/" + key,
      media_type: data?.media_type ?? "image",
      mime_type: data?.mime_type ?? "image/*",
      byte_size: Number(data?.byte_size ?? 0),
    };
    await redisSetJson(cacheKey, route, isProfile ? 300 : 600);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: route.url,
      "Cache-Control": "public, max-age=60, s-maxage=600, stale-while-revalidate=3600",
      "Vary": "Accept",
      "X-Testagram-Media-Plane": "upstash-redis+r2-origin",
      "X-Testagram-Media-Type": route.media_type,
      "Content-Type": route.mime_type,
      ...(route.byte_size > 0 ? { "Content-Length": String(route.byte_size) } : {}),
    },
  });
});
