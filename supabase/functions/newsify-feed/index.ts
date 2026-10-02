import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { redisGetJson, redisIncrWithExpiry, redisSetJson } from "../_shared/upstash-redis.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const rateLimit = async (req: Request, keyPart: string, limit: number) => {\n  const windowSeconds = 60;\n  const subject = req.headers.get("cf-connecting-ip")?.trim()\n    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()\n    || "anonymous";\n  const key = `testagram:ratelimit:newsify:${keyPart}:${subject}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;\n  const count = await redisIncrWithExpiry(key, windowSeconds + 2);\n  return count === null ? null : { allowed: count <= limit, count };\n};\n\nconst cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return Response.json({ error: "GET required" }, { status: 405, headers: cors });
  const urlValue = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(urlValue.searchParams.get("limit") ?? "20")));
  const geo = (urlValue.searchParams.get("geo") ?? "US").trim().toUpperCase();
  const language = (urlValue.searchParams.get("language") ?? "english").trim();
  const cacheKey = `testagram:newsify:trending:${geo}:${language}:${limit}`;
  const cached = await redisGetJson<{ items?: unknown[]; geo?: string; language?: string }>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: { ...cors, "Cache-Control": "public,max-age=30,stale-while-revalidate=120", "X-Testagram-Redis-Cache": "HIT" },
    });
  }

  try {
    const { data, error } = await db.rpc("list_newsify_trending", {
      p_limit: limit,
      p_geo: geo,
      p_language: language,
    });
    if (error) throw error;
    const dataPayload = data ?? { items: [], geo, language };
    await redisSetJson(cacheKey, dataPayload, 30);
    return new Response(JSON.stringify(dataPayload), {
      status: 200,
      headers: { ...cors, "Cache-Control": "public,max-age=30,stale-while-revalidate=120", "X-Testagram-Redis-Cache": "MISS" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: cors,
    });
  }
});