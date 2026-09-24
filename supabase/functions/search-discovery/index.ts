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
function cleanQuery(value: unknown) { const q = typeof value === "string" ? value.trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ") : ""; if (q.length > 120) throw new Error("INVALID_QUERY"); return q; }

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-request-id", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ ok: false, data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST required" }, request_id: requestId }, 405, requestId);
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, data: null, error: { code: "AUTH_REQUIRED", message: "Authentication required" }, request_id: requestId }, 401, requestId);
  const db = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });

  return withServiceMetric(db, "search", "discovery", async () => {
    try {
      const { data: authData, error: authError } = await db.auth.getUser();
      if (authError || !authData.user) return json({ ok: false, data: null, error: { code: "AUTH_REQUIRED", message: "Authentication required" }, request_id: requestId }, 401, requestId);
      const key = authData.user.id; const now = Date.now(); const bucket = buckets.get(key);
      if (!bucket || now - bucket.started >= WINDOW_MS) buckets.set(key, { started: now, count: 1 });
      else { bucket.count += 1; if (bucket.count > MAX_REQUESTS) return json({ ok: false, data: null, error: { code: "RATE_LIMITED", message: "Too many search requests; retry shortly." }, request_id: requestId }, 429, requestId, { "Retry-After": "60" }); }
      const body = await req.json().catch(() => ({}));
      const q = cleanQuery(body.q);
      const limit = limitOf(body.limit);
      const offset = decodeCursor(body.cursor);
      const mode = body.mode === "suggest" ? "suggest" : "search";
      const kind = ["all","people","posts","hashtags","mentions","media","conversations","instances"].includes(body.kind) ? body.kind : "all";
      const token = q.replace(/^[@#]/, "");

      if (kind === "instances") {
        const { data, error } = await db.from("federated_actors").select("domain").not("domain", "is", null).ilike("domain", `%${token}%`).limit(2000);
        if (error) throw error;
        const counts = new Map<string, number>();
        for (const row of data ?? []) counts.set(String(row.domain), (counts.get(String(row.domain)) ?? 0) + 1);
        const items = [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(offset, offset + limit).map(([domain, accounts]) => ({ domain, accounts, origin: "fediverse" }));
        return json({ ok: true, data: { users: [], hashtags: [], posts: [], communities: [], items, next_cursor: items.length === limit ? encodeCursor(offset + limit) : null }, error: null, request_id: requestId }, 200, requestId);
      }

      if (["mentions","media","conversations"].includes(kind)) {
        let request = db.from("federated_objects").select("id,uri,actor_uri,content,summary,published_at,updated_at,attachments,tags,like_count,announce_count,reply_count,quote_count,object_type,url,in_reply_to_uri,sensitive,content_warning").is("deleted_at", null).order("published_at", { ascending: false });
        if (kind === "media") request = request.not("attachments", "is", null);
        if (kind === "conversations") request = request.not("in_reply_to_uri", "is", null);
        const { data, error } = await request.range(offset, offset + limit);
        if (error) throw error;
        let items = data ?? [];
        if (kind === "mentions") items = items.filter((row: any) => Array.isArray(row.tags) && row.tags.some((tag: any) => String(tag?.type ?? "").toLowerCase() === "mention" && (!token || String(tag?.name ?? tag?.href ?? "").toLowerCase().includes(token.toLowerCase()))));
        else if (kind === "media") items = items.filter((row: any) => Array.isArray(row.attachments) && row.attachments.length > 0 && (!token || String(row.content ?? row.summary ?? "").toLowerCase().includes(token.toLowerCase())));
        else if (token) items = items.filter((row: any) => String(row.content ?? row.summary ?? "").toLowerCase().includes(token.replace(/[%_]/g, "").toLowerCase()));
        return json({ ok: true, data: { users: [], hashtags: [], posts: [], communities: [], items: items.slice(0, limit), next_cursor: items.length === limit ? encodeCursor(offset + limit) : null }, error: null, request_id: requestId }, 200, requestId);
      }

      const [usersRes, postsRes, hashtagsRes, communitiesRes, fedUsersRes, fedPostsRes] = await Promise.all([
        db.from("profiles").select("id,username,display_name,avatar_url,bio,verified").or(`username.ilike.%${token}%,display_name.ilike.%${token}%`).order("verified", { ascending: false }).order("username", { ascending: true }).range(0, mode === "suggest" ? 7 : 29),
        mode === "suggest" ? Promise.resolve({ data: [] as any[], error: null }) : db.from("posts").select("id,author_id,user_id,body,content,created_at,updated_at,media_url,media_type").is("deleted_at", null).or(`body.ilike.%${token}%,content.ilike.%${token}%`).order("created_at", { ascending: false }).range(offset, offset + limit - 1),
        mode === "suggest" ? db.from("hashtags").select("id,tag,usage_count,post_count,federated_post_count").ilike("tag", `${token}%`).order("usage_count", { ascending: false }).order("federated_post_count", { ascending: false }).limit(8) : db.from("hashtags").select("id,tag,usage_count,post_count,federated_post_count").ilike("tag", `%${token}%`).order("usage_count", { ascending: false }).order("federated_post_count", { ascending: false }).range(0, 29),
        mode === "suggest" ? Promise.resolve({ data: [] as any[], error: null }) : db.from("communities").select("id,name,slug,display_name,description,avatar_url,member_count,post_count").or(`name.ilike.%${token}%,display_name.ilike.%${token}%,description.ilike.%${token}%`).order("member_count", { ascending: false }).range(0, 19),
        db.from("federation_remote_actors").select("id,username,acct,domain,actor_url,actor").or(`username.ilike.%${token}%,acct.ilike.%${token}%`).limit(mode === "suggest" ? 8 : 30),
        mode === "suggest" ? Promise.resolve({ data: [] as any[], error: null }) : db.from("federated_objects").select("id,uri,actor_uri,content,summary,published_at,updated_at,attachments,tags,like_count,announce_count,reply_count,object_type,url").is("deleted_at", null).or(`content.ilike.%${token}%,summary.ilike.%${token}%`).order("published_at", { ascending: false }).range(offset, offset + limit - 1),
      ]);
      const firstError = [usersRes, postsRes, hashtagsRes, communitiesRes, fedUsersRes, fedPostsRes].find((r: any) => r?.error)?.error;
      if (firstError) throw firstError;
      const normalizedHashtags = (hashtagsRes.data ?? []).map((h: any) => ({ ...h, total_posts: Number(h.usage_count ?? 0) + Number(h.federated_post_count ?? 0), origin: Number(h.federated_post_count ?? 0) > 0 ? "mixed" : "testagram" }));
      const fedUsers = (fedUsersRes.data ?? []).map((r: any) => ({ id: `fed:${r.actor_url ?? r.id}`, username: r.username ?? r.actor?.preferredUsername ?? "user", display_name: r.actor?.name ?? r.actor?.displayName ?? r.username ?? "Fediverse user", avatar_url: r.actor?.icon?.url ?? r.actor?.icon?.href ?? null, bio: r.actor?.summary ?? r.actor?.bio ?? "", verified: Boolean(r.actor?.verified), origin: "fediverse", actor_uri: r.actor_url, acct: r.acct ?? null, domain: r.domain ?? null }));
      const fedPosts = (fedPostsRes.data ?? []).map((p: any) => ({ ...p, origin: "fediverse", is_federated: true, author_id: p.actor_uri, user_id: p.actor_uri, created_at: p.published_at ?? p.updated_at, remote_status_uri: p.uri }));
      const users = [...(usersRes.data ?? []), ...fedUsers];
      const posts = [...(postsRes.data ?? []), ...fedPosts].slice(0, limit);
      const items = kind === "people" ? users.slice(offset, offset + limit) : kind === "posts" ? posts : kind === "hashtags" ? normalizedHashtags.slice(offset, offset + limit) : [...users, ...normalizedHashtags, ...posts].slice(0, limit);
      const hasMore = kind === "people"
        ? users.length > offset + limit
        : kind === "hashtags"
          ? normalizedHashtags.length > offset + limit
          : posts.length === limit;
      return json({ ok: true, data: { users: [...(usersRes.data ?? []), ...fedUsers], hashtags: normalizedHashtags, posts, communities: communitiesRes.data ?? [], items, next_cursor: hasMore ? encodeCursor(offset + limit) : null }, error: null, request_id: requestId }, 200, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed"; return json({ ok: false, data: null, error: { code: message === "INVALID_QUERY" ? "INVALID_QUERY" : "SEARCH_FAILED", message }, request_id: requestId }, message === "INVALID_QUERY" ? 400 : 500, requestId);
    }
  });
});
