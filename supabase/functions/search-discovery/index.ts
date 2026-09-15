import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withServiceMetric } from "../_shared/observability.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
const buckets = new Map<string, { started: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 45;

const json = (body: unknown, status = 200, requestId = crypto.randomUUID(), extra: Record<string,string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-request-id", "Access-Control-Allow-Methods": "POST, OPTIONS", "X-Request-Id": requestId, ...extra },
});
function limitOf(value: unknown) { const n = Number(value ?? 20); return Math.min(50, Math.max(1, Number.isFinite(n) ? Math.trunc(n) : 20)); }
function decodeCursor(value: unknown) { if (typeof value !== "string" || !value) return 0; try { const n = Number(atob(value)); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; } catch { return 0; } }
function encodeCursor(value: number) { return btoa(String(value)); }
function cleanQuery(value: unknown) { const q = typeof value === "string" ? value.trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ") : ""; if (!q || q.length > 120) throw new Error("INVALID_QUERY"); return q; }

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-request-id", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ ok: false, data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST required" }, request_id: requestId }, 405, requestId);
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, data: null, error: { code: "AUTH_REQUIRED", message: "Authentication required" }, request_id: requestId }, 401, requestId);
  const db = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });

  return withServiceMetric("search", "discovery", async () => {
    try {
      const { data: authData, error: authError } = await db.auth.getUser();
      if (authError || !authData.user) return json({ ok: false, data: null, error: { code: "AUTH_REQUIRED", message: "Authentication required" }, request_id: requestId }, 401, requestId);
      const key = authData.user.id; const now = Date.now(); const bucket = buckets.get(key);
      if (!bucket || now - bucket.started >= WINDOW_MS) buckets.set(key, { started: now, count: 1 });
      else { bucket.count += 1; if (bucket.count > MAX_REQUESTS) return json({ ok: false, data: null, error: { code: "RATE_LIMITED", message: "Too many search requests; retry shortly." }, request_id: requestId }, 429, requestId, { "Retry-After": "60" }); }
      const body = await req.json().catch(() => ({}));
      const q = cleanQuery(body.q); const limit = limitOf(body.limit); const offset = decodeCursor(body.cursor); const mode = body.mode === "suggest" ? "suggest" : "search"; const token = q.replace(/^[@#]/, "");
      const [usersRes, postsRes, hashtagsRes, communitiesRes] = await Promise.all([
        db.from("profiles").select("id,username,display_name,avatar_url,bio,verified").or(`username.ilike.%${token}%,display_name.ilike.%${token}%`).order("verified", { ascending: false }).order("username", { ascending: true }).range(0, mode === "suggest" ? 7 : 29),
        mode === "suggest" ? Promise.resolve({ data: [] as any[], error: null }) : db.from("posts").select("id,author_id,user_id,body,content,created_at,updated_at,media_url,media_type").is("deleted_at", null).or(`body.ilike.%${token}%,content.ilike.%${token}%`).order("created_at", { ascending: false }).range(offset, offset + limit),
        mode === "suggest" ? db.from("hashtags").select("id,tag,usage_count").ilike("tag", `${token}%`).order("usage_count", { ascending: false }).limit(8) : db.from("hashtags").select("id,tag,usage_count").ilike("tag", `%${token}%`).order("usage_count", { ascending: false }).range(0, 29),
        mode === "suggest" ? Promise.resolve({ data: [] as any[], error: null }) : db.from("communities").select("id,name,slug,display_name,description,avatar_url,member_count,post_count").or(`name.ilike.%${token}%,display_name.ilike.%${token}%,description.ilike.%${token}%`).order("member_count", { ascending: false }).range(0, 19),
      ]);
      const firstError = [usersRes, postsRes, hashtagsRes, communitiesRes].find((r: any) => r?.error)?.error; if (firstError) throw firstError;
      const posts = postsRes.data ?? [];
      return json({ ok: true, data: { users: usersRes.data ?? [], hashtags: hashtagsRes.data ?? [], posts: posts.slice(0, limit), communities: communitiesRes.data ?? [], next_cursor: posts.length > limit ? encodeCursor(offset + limit) : null }, error: null, request_id: requestId }, 200, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed"; return json({ ok: false, data: null, error: { code: message === "INVALID_QUERY" ? "INVALID_QUERY" : "SEARCH_FAILED", message }, request_id: requestId }, message === "INVALID_QUERY" ? 400 : 500, requestId);
    }
  });
});
