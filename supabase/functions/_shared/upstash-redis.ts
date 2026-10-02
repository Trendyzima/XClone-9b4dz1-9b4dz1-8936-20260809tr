import { createClient } from "npm:@supabase/supabase-js@2";

type RedisConfig = { url: string; token: string };
let configPromise: Promise<RedisConfig | null> | null = null;

async function loadConfig(): Promise<RedisConfig | null> {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) return null;
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: urlData, error: urlError }, { data: tokenData, error: tokenError }] = await Promise.all([
      db.rpc("get_secret_for_worker", { secret_name: "upstash_redis_rest_url" }),
      db.rpc("get_secret_for_worker", { secret_name: "upstash_redis_rest_token" }),
    ]);
    const url = typeof urlData === "string" ? urlData.trim() : "";
    const token = typeof tokenData === "string" ? tokenData.trim() : "";
    if (urlError || tokenError || !url || !token) return null;
    return { url: url.replace(/\/$/, ""), token };
  })().catch(() => null);
  return configPromise;
}
async function command<T = unknown>(args: string[]): Promise<T | null> {
  const config = await loadConfig();
  if (!config) return null;
  try {
    const response = await fetch(config.url, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (!response.ok) return null;
    const payload = await response.json() as { result?: T };
    return payload.result ?? null;
  } catch { return null; }
}
export async function redisGetJson<T>(key: string): Promise<T | null> {
  const raw = await command<string>(["GET", key]);
  if (typeof raw !== "string" || !raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
export async function redisSetJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const result = await command<string>(["SET", key, JSON.stringify(value), "EX", String(Math.max(1, Math.floor(ttlSeconds)))]);
  return result === "OK";
}
export async function redisIncrWithExpiry(key: string, ttlSeconds: number): Promise<number | null> {
  const value = await command<number>(["INCR", key]);
  if (typeof value !== "number") return null;
  if (value === 1) {\n    const ttl = Math.max(1, Math.floor(ttlSeconds));\n    await command(["EXPIRE", key, String(ttl)]);\n  }
  return value;
}