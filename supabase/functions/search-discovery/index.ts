import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withServiceMetric } from "./_shared/observability.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";\nconst serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
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

function normalizeRemoteStatus(status: any, domain: string) {
  const account = status?.account ?? {};
  const uri = status?.uri ?? status?.url ?? status?.id;
  if (!uri) return null;
  return {
    ...status,
    id: uri,
    uri,
    url: status?.url ?? uri,
    remote_status_uri: uri,
    actor_uri: account?.url ?? account?.uri ?? status?.actor_uri ?? null,
    author_id: account?.id ?? status?.actor_uri ?? null,
    user_id: account?.id ?? status?.actor_uri ?? null,
    created_at: status?.created_at ?? status?.published ?? null,
    content: status?.content ?? status?.spoiler_text ?? "",
    user_profiles: {
      id: account?.id ?? null,
      username: account?.username ?? account?.acct?.split("@")[0] ?? "fediverse",
      display_name: account?.display_name ?? account?.username ?? "Fediverse user",
      avatar_url: account?.avatar ?? account?.avatar_static ?? null,
      verified: Boolean(account?.verified),
      acct: account?.acct ?? account?.username ?? null,
      domain,
    },
    origin: "fediverse",
    is_federated: true,
    source_instance: domain,
  };
}
function normalizeRemoteAccount(account: any, domain: string) {
  if (!account) return null;
  const actor = account?.url ?? account?.uri ?? account?.id;
  if (!actor) return null;
  return {
    id: `fed:${actor}`,
    actor_uri: actor,
    actor_url: actor,
    username: account?.username ?? account?.acct?.split("@")[0] ?? "user",
    display_name: account?.display_name ?? account?.username ?? "Fediverse user",
    avatar_url: account?.avatar ?? account?.avatar_static ?? null,
    bio: account?.note ?? account?.bio ?? "",
    acct: account?.acct ?? account?.username ?? null,
    domain,
    verified: Boolean(account?.verified),
    discoverable: account?.discoverable !== false,
    origin: "fediverse",
  };
}
function normalizeRemoteTag(tag: any, domain: string) {
  const name = String(tag?.name ?? tag?.tag ?? "").replace(/^#/, "").trim();
  if (!name) return null;
  return { ...tag, id: `fed-tag:${name.toLowerCase()}@${domain}`, tag: name, name, origin: "fediverse", domain, url: tag?.url ?? `https://${domain}/tags/${encodeURIComponent(name)}` };
}
async function remoteFetch(url: string, timeoutMs = 4500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Testagram-Fediverse-Search/1.0" }, signal: ctl.signal, redirect: "follow" });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch { return null; } finally { clearTimeout(timer); }
}
async function remoteDiscover(db: any, rawQuery: string, kind: string, limit: number) {
  const q = rawQuery.trim();
  const token = q.replace(/^[@#]/, "");
  const isHash = q.startsWith("#");
  const isMention = q.startsWith("@");
  const exactHandle = token.includes("@") ? token : "";
  const domainsForHandle = exactHandle ? [exactHandle.split("@").pop()!] : [];
  const { data: actorMatches } = await db.from("federated_actors").select("domain,actor_uri,username").ilike("username", `%${token.split("@")[0]}%`).limit(30);
  const actorDomains = (actorMatches ?? []).map((r: any) => String(r.domain ?? "")).filter(Boolean);
  const { data: instances } = await db.from("federated_instances").select("domain,software,public_timeline_available,last_success_at,backoff_until").not("domain","is",null).or("backoff_until.is.null,backoff_until.lt.now()").order("last_success_at",{ascending:false,nullsFirst:false}).limit(80);
  const candidates = new Map<string, any>();
  for (const row of instances ?? []) {
    const domain = String(row.domain ?? "").toLowerCase().trim();
    if (!domain || candidates.has(domain)) continue;
    const software = String(row.software ?? "").toLowerCase();
    const mastodonLike = !software || software.includes("mastodon") || software.includes("akkoma") || software.includes("gotosocial");
    if (mastodonLike) candidates.set(domain, row);
  }
  for (const d of [...actorDomains, ...domainsForHandle]) if (d) candidates.set(d.toLowerCase(), { domain:d.toLowerCase(), software:"targeted" });
  const selected = [...candidates.values()].slice(0, isHash || isMention ? 18 : 14);
  const results = { users: [] as any[], posts: [] as any[], hashtags: [] as any[], instances: [] as any[] };
  const seen = { users:new Set<string>(), posts:new Set<string>(), hashtags:new Set<string>() };
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const row = selected[cursor++];
      if (!row) return;
      const domain = String(row.domain);
      const base = `https://${domain}`;
      let payload: any = null;
      if (isHash) {
        const tag = encodeURIComponent(token);
        payload = await remoteFetch(`${base}/api/v1/timelines/tag/${tag}?limit=12`);
        if (Array.isArray(payload)) for (const s of payload) { const n=normalizeRemoteStatus(s,domain); if(n&&!seen.posts.has(n.uri)){seen.posts.add(n.uri);results.posts.push(n)} }
        const search = await remoteFetch(`${base}/api/v2/search?q=${encodeURIComponent(token)}&type=hashtags&limit=8`);
        for (const t of (search?.hashtags ?? [])) { const n=normalizeRemoteTag(t,domain); if(n&&!seen.hashtags.has(n.tag.toLowerCase())){seen.hashtags.add(n.tag.toLowerCase());results.hashtags.push(n)} }
      } else if (isMention) {
        const search = await remoteFetch(`${base}/api/v2/search?q=${encodeURIComponent(token)}&type=accounts&resolve=true&limit=8`);
        for (const a of (search?.accounts ?? [])) { const n=normalizeRemoteAccount(a,domain); if(n&&!seen.users.has(n.actor_uri)){seen.users.add(n.actor_uri);results.users.push(n)} }
        if (!exactHandle) {
          const statuses = await remoteFetch(`${base}/api/v2/search?q=${encodeURIComponent(token)}&type=statuses&limit=10`);
          for (const s of (statuses?.statuses ?? [])) { const n=normalizeRemoteStatus(s,domain); if(n&&!seen.posts.has(n.uri)){seen.posts.add(n.uri);results.posts.push(n)} }
        }
      } else {
        const search = await remoteFetch(`${base}/api/v2/search?q=${encodeURIComponent(token)}&type=statuses&limit=10`);
        for (const s of (search?.statuses ?? [])) { const n=normalizeRemoteStatus(s,domain); if(n&&!seen.posts.has(n.uri)){seen.posts.add(n.uri);results.posts.push(n)} }
        for (const a of (search?.accounts ?? [])) { const n=normalizeRemoteAccount(a,domain); if(n&&!seen.users.has(n.actor_uri)){seen.users.add(n.actor_uri);results.users.push(n)} }
        for (const t of (search?.hashtags ?? [])) { const n=normalizeRemoteTag(t,domain); if(n&&!seen.hashtags.has(n.tag.toLowerCase())){seen.hashtags.add(n.tag.toLowerCase());results.hashtags.push(n)} }
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(5,selected.length)},()=>worker()));
  return {
    users: results.users.slice(0,limit),
    posts: results.posts.slice(0,limit),
    hashtags: results.hashtags.slice(0,limit),
    instances: [...new Set(selected.map((r:any)=>String(r.domain)))].map(domain=>({domain,origin:"fediverse"})).slice(0,limit),
  };
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-request-id", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ ok: false, data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST required" }, request_id: requestId }, 405, requestId);
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, data: null, error: { code: "AUTH_REQUIRED", message: "Authentication required" }, request_id: requestId }, 401, requestId);
  const db = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });\n  const discoveryDb = serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : db;

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
      const kind = ["all","people","posts","hashtags","mentions","media","conversations","instances","fediverse"].includes(body.kind) ? body.kind : "all";
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
        db.from("federated_actors").select("id,username,domain,actor_uri,display_name,avatar_url,bio").or(`username.ilike.%${token}%,domain.ilike.%${token}%,display_name.ilike.%${token}%`).limit(mode === "suggest" ? 8 : 30),
        mode === "suggest" ? Promise.resolve({ data: [] as any[], error: null }) : db.from("federated_objects").select("id,uri,actor_uri,content,summary,published_at,updated_at,attachments,tags,like_count,announce_count,reply_count,object_type,url").is("deleted_at", null).or(`content.ilike.%${token}%,summary.ilike.%${token}%`).order("published_at", { ascending: false }).range(offset, offset + limit - 1),
      ]);
      const firstError = [usersRes, postsRes, hashtagsRes, communitiesRes, fedUsersRes, fedPostsRes].find((r: any) => r?.error)?.error;
      if (firstError) throw firstError;
      const remote = await remoteDiscover(discoveryDb, q, kind, limit);
      const remoteUsers = remote.users;
      const remotePosts = remote.posts;
      const remoteHashtags = remote.hashtags;
      const normalizedHashtags = (hashtagsRes.data ?? []).map((h: any) => ({ ...h, total_posts: Number(h.usage_count ?? 0) + Number(h.federated_post_count ?? 0), origin: Number(h.federated_post_count ?? 0) > 0 ? "mixed" : "testagram" }));
      const fedUsers = [...(fedUsersRes.data ?? []), ...remoteUsers].map((r: any) => ({ id: `fed:${r.actor_uri ?? r.id}`, username: r.username ?? "user", display_name: r.display_name ?? r.username ?? "Fediverse user", avatar_url: r.avatar_url ?? null, bio: r.bio ?? "", verified: false, origin: "fediverse", actor_uri: r.actor_uri, acct: r.domain ? `${r.username}@${r.domain}` : r.username, domain: r.domain ?? null }));
      const fedPosts = [...(fedPostsRes.data ?? []), ...remotePosts].map((p: any) => ({ ...p, origin: "fediverse", is_federated: true, author_id: p.author_id ?? p.actor_uri, user_id: p.user_id ?? p.actor_uri, created_at: p.created_at ?? p.published_at ?? p.updated_at, remote_status_uri: p.remote_status_uri ?? p.uri }));
      const users = [...(usersRes.data ?? []), ...fedUsers];
      const posts = [...(postsRes.data ?? []), ...fedPosts].slice(0, limit);
      const mergedHashtags = [...normalizedHashtags, ...remoteHashtags];
      const items = kind === "people" ? users.slice(offset, offset + limit) : kind === "posts" ? posts : kind === "hashtags" ? mergedHashtags.slice(offset, offset + limit) : [...users, ...mergedHashtags, ...posts].slice(0, limit);
      const hasMore = kind === "people"
        ? users.length > offset + limit
        : kind === "hashtags"
          ? mergedHashtags.length > offset + limit
          : posts.length === limit;
      return json({ ok: true, data: { users: [...(usersRes.data ?? []), ...fedUsers], hashtags: mergedHashtags, posts, communities: communitiesRes.data ?? [], items, next_cursor: hasMore ? encodeCursor(offset + limit) : null }, error: null, request_id: requestId }, 200, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed"; return json({ ok: false, data: null, error: { code: message === "INVALID_QUERY" ? "INVALID_QUERY" : "SEARCH_FAILED", message }, request_id: requestId }, message === "INVALID_QUERY" ? 400 : 500, requestId);
    }
  });
});
