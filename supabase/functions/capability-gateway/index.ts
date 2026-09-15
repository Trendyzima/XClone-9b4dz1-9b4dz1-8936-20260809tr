import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getCapability, CAPABILITIES, type CapabilityName } from "../_shared/capabilities.ts";
import { withServiceMetric } from "../_shared/observability.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");

const json = (body: unknown, status = 200, requestId = crypto.randomUUID()) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "X-Request-Id": requestId,
  },
});

function errorEnvelope(requestId: string, code: string, message: string, status: number) {
  return json({ ok: false, data: null, error: { code, message }, request_id: requestId }, status, requestId);
}

function pageSize(value: unknown): number {
  const n = Number(value ?? 20);
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}
function offsetOf(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  try { const n = Number(atob(value)); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; } catch { return 0; }
}
function cursor(offset: number): string { return btoa(String(offset)); }
function id(value: unknown, name: string): string { if (typeof value !== "string" || !value) throw new Error(`${name}_REQUIRED`); return value; }

async function requireUser(db: SupabaseClient, requestId: string) {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error(`AUTH_REQUIRED:${requestId}`);
  return data.user;
}

async function executeCapability(db: SupabaseClient, name: CapabilityName, input: Record<string, unknown>, requestId: string) {
  switch (name) {
    case "testagram.capabilities.list": return { capabilities: CAPABILITIES };
    case "testagram.health.read": {
      const { data, error } = await db.from("service_plane_health").select("service,events_24h,failures_24h,avg_duration_ms,last_event_at");
      if (error) throw error; return { services: data ?? [] };
    }
    case "testagram.posts.list": {
      await requireUser(db, requestId); const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data, error } = await db.from("posts").select("id,author_id,user_id,body,content,created_at,updated_at,media_url,media_type,media_count,community_id").is("deleted_at", null).order("created_at", { ascending: false }).range(offset, offset + limit);
      if (error) throw error; const rows = data ?? []; return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }
    case "testagram.posts.create": {
      const user = await requireUser(db, requestId); const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!body || body.length > 5000) throw new Error("INVALID_BODY");
      const communityId = typeof input.community_id === "string" ? input.community_id : null;
      const { data, error } = await db.from("posts").insert({ author_id: user.id, user_id: user.id, body, content: body, community_id: communityId, media_count: 0, media_urls: [] }).select("id,author_id,user_id,body,content,community_id,created_at,updated_at").single();
      if (error) throw error; return { post: data };
    }
    case "testagram.search.posts": {
      await requireUser(db, requestId); const q = typeof input.q === "string" ? input.q.trim() : ""; if (!q) throw new Error("QUERY_REQUIRED");
      const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data, error } = await db.from("posts").select("id,author_id,user_id,body,content,created_at,updated_at,media_url,media_type").is("deleted_at", null).or(`body.ilike.%${q}%,content.ilike.%${q}%`).order("created_at", { ascending: false }).range(offset, offset + limit);
      if (error) throw error; const rows = data ?? []; return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }
    case "testagram.search.users": {
      await requireUser(db, requestId); const q = typeof input.q === "string" ? input.q.trim() : ""; if (!q) throw new Error("QUERY_REQUIRED");
      const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data, error } = await db.from("profiles").select("id,username,display_name,avatar_url,bio,verified").or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).order("username", { ascending: true }).range(offset, offset + limit);
      if (error) throw error; const rows = data ?? []; return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }
    case "testagram.recommendations.generate": {
      const user = await requireUser(db, requestId); const { data, error } = await db.rpc("generate_content_recommendations", { p_user_id: user.id });
      if (error) throw error; return { recommendations: data ?? [] };
    }
    case "testagram.notifications.rank": {
      const user = await requireUser(db, requestId); const { data, error } = await db.rpc("rank_notifications", { p_user_id: user.id, p_limit: pageSize(input.limit) });
      if (error) throw error; return { items: data ?? [], next_cursor: null };
    }

    case "testagram.lists.list": {
      const user = await requireUser(db, requestId); const { data, error } = await db.from("lists").select("id,owner_id,name,description,is_private,created_at,updated_at").or(`owner_id.eq.${user.id},is_private.eq.false`).order("updated_at", { ascending: false });
      if (error) throw error; return { items: data ?? [] };
    }
    case "testagram.lists.create": {
      const user = await requireUser(db, requestId); const name = typeof input.name === "string" ? input.name.trim() : ""; if (!name || name.length > 100) throw new Error("INVALID_NAME");
      const { data, error } = await db.from("lists").insert({ owner_id: user.id, name, description: typeof input.description === "string" ? input.description.slice(0, 500) : null, is_private: input.is_private === true }).select("id,owner_id,name,description,is_private,created_at,updated_at").single();
      if (error) throw error; return { list: data };
    }
    case "testagram.lists.member.add": {
      await requireUser(db, requestId); const listId = id(input.list_id, "LIST_ID"); const userId = id(input.user_id, "USER_ID");
      const { data, error } = await db.from("list_members").insert({ list_id: listId, user_id: userId }).select("list_id,user_id,created_at").single(); if (error) throw error; return { member: data };
    }
    case "testagram.lists.member.remove": {
      await requireUser(db, requestId); const listId = id(input.list_id, "LIST_ID"); const userId = id(input.user_id, "USER_ID");
      const { error } = await db.from("list_members").delete().eq("list_id", listId).eq("user_id", userId); if (error) throw error; return { removed: true };
    }
    case "testagram.lists.timeline": {
      await requireUser(db, requestId); const listId = id(input.list_id, "LIST_ID"); const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data, error } = await db.rpc("get_list_timeline", { p_list_id: listId, p_limit: limit + 1, p_offset: offset }); if (error) throw error;
      const rows = Array.isArray(data) ? data : []; return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }

    case "testagram.bookmarks.list": {
      const user = await requireUser(db, requestId); const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data, error } = await db.from("bookmarks").select("post_id,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).range(offset, offset + limit); if (error) throw error;
      const rows = data ?? []; return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }
    case "testagram.bookmarks.add": {
      const user = await requireUser(db, requestId); const postId = id(input.post_id, "POST_ID"); const { data, error } = await db.from("bookmarks").upsert({ user_id: user.id, post_id: postId }, { onConflict: "user_id,post_id" }).select("post_id,created_at").single(); if (error) throw error; return { bookmark: data };
    }
    case "testagram.bookmarks.remove": {
      const user = await requireUser(db, requestId); const postId = id(input.post_id, "POST_ID"); const { error } = await db.from("bookmarks").delete().eq("user_id", user.id).eq("post_id", postId); if (error) throw error; return { removed: true };
    }
    case "testagram.bookmarks.folders.list": {
      const user = await requireUser(db, requestId); const { data, error } = await db.from("bookmark_folders").select("id,owner_id,name,created_at,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }); if (error) throw error; return { items: data ?? [] };
    }
    case "testagram.bookmarks.folders.create": {
      const user = await requireUser(db, requestId); const name = typeof input.name === "string" ? input.name.trim() : ""; if (!name || name.length > 100) throw new Error("INVALID_NAME");
      const { data, error } = await db.from("bookmark_folders").insert({ owner_id: user.id, name }).select("id,owner_id,name,created_at,updated_at").single(); if (error) throw error; return { folder: data };
    }

    case "testagram.trends.list": {
      await requireUser(db, requestId); const limit = pageSize(input.limit); const { data, error } = await db.from("trending_topics").select("id,topic,posts_count,trend_score,window_hours,updated_at").order("trend_score", { ascending: false }).limit(limit); if (error) throw error; return { items: data ?? [] };
    }
    case "testagram.follows.set": {
      await requireUser(db, requestId); const followingId = id(input.user_id, "USER_ID"); const follow = input.follow === true; const { data, error } = await db.rpc("set_follow_state", { p_following_id: followingId, p_follow: follow }); if (error) throw error; return { state: data ?? null };
    }
    case "testagram.follows.state": {
      await requireUser(db, requestId); const followingId = id(input.user_id, "USER_ID"); const { data, error } = await db.rpc("get_follow_state", { p_following_id: followingId }); if (error) throw error; return { state: data ?? null };
    }
    case "testagram.posts.like": {
      await requireUser(db, requestId); const postId = id(input.post_id, "POST_ID"); const { data, error } = await db.rpc("toggle_post_like", { p_post_id: postId }); if (error) throw error; return { state: data ?? null };
    }
    case "testagram.posts.repost": {
      await requireUser(db, requestId); const postId = id(input.post_id, "POST_ID"); const { data, error } = await db.rpc("toggle_post_repost", { p_post_id: postId }); if (error) throw error; return { state: data ?? null };
    }

    case "testagram.media.list": {
      const user = await requireUser(db, requestId); const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data, error } = await db.from("media_assets").select("id,owner_id,storage_key,media_url,media_type,mime_type,byte_size,width,height,duration_ms,metadata,created_at,bucket,original_name,post_id,status,updated_at").eq("owner_id", user.id).order("created_at", { ascending: false }).range(offset, offset + limit); if (error) throw error;
      const rows = data ?? []; return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }
    case "testagram.media.attach": {
      const user = await requireUser(db, requestId); const postId = id(input.post_id, "POST_ID"); const assetId = id(input.media_asset_id, "MEDIA_ASSET_ID");
      const { data: asset, error: assetError } = await db.from("media_assets").select("id,media_url,media_type,mime_type,byte_size,width,height,duration_ms").eq("id", assetId).eq("owner_id", user.id).single(); if (assetError) throw assetError;
      const { data, error } = await db.from("post_media").insert({ post_id: postId, owner_id: user.id, media_url: asset.media_url, media_type: asset.media_type, mime_type: asset.mime_type, byte_size: asset.byte_size, width: asset.width, height: asset.height, duration_ms: asset.duration_ms, media_asset_id: asset.id, sort_order: Number(input.sort_order ?? 0) }).select("id,post_id,owner_id,media_url,media_type,mime_type,sort_order,created_at,media_asset_id").single(); if (error) throw error; return { media: data };
    }

    case "testagram.communities.list": {
      await requireUser(db, requestId); const limit = pageSize(input.limit); const { data, error } = await db.from("communities").select("id,owner_id,name,slug,description,avatar_url,is_private,member_count,created_at,display_name,icon_url,banner_url,post_count,created_by,rules,updated_at").order("updated_at", { ascending: false }).limit(limit); if (error) throw error; return { items: data ?? [] };
    }
    case "testagram.communities.create": {
      await requireUser(db, requestId); const name = typeof input.name === "string" ? input.name.trim() : ""; if (!name) throw new Error("NAME_REQUIRED");
      const { data, error } = await db.rpc("create_community", { p_name: name, p_display_name: typeof input.display_name === "string" ? input.display_name : name, p_description: typeof input.description === "string" ? input.description : null, p_is_private: input.is_private === true, p_rules: input.rules && typeof input.rules === "object" ? input.rules : {}, p_icon_url: typeof input.icon_url === "string" ? input.icon_url : null, p_banner_url: typeof input.banner_url === "string" ? input.banner_url : null }); if (error) throw error; return { community: data ?? null };
    }
    case "testagram.communities.join": {
      await requireUser(db, requestId); const communityId = id(input.community_id, "COMMUNITY_ID"); const { data, error } = await db.rpc("join_community", { p_community_id: communityId }); if (error) throw error; return { membership: data ?? null };
    }
    case "testagram.communities.leave": {
      await requireUser(db, requestId); const communityId = id(input.community_id, "COMMUNITY_ID"); const { data, error } = await db.rpc("leave_community", { p_community_id: communityId }); if (error) throw error; return { membership: data ?? null };
    }

    case "testagram.federation.status": {
      const user = await requireUser(db, requestId); const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data, error } = await db.from("federation_outbox").select("id,activity_id,activity_type,actor_url,inbox_url,status,attempts,last_attempt_at,next_attempt_at,http_status,last_error,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false }).range(offset, offset + limit); if (error) throw error;
      const rows = data ?? []; return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }
    case "testagram.wallet.read": {
      await requireUser(db, requestId); const limit = pageSize(input.limit); const offset = offsetOf(input.cursor);
      const { data: wallet, error: walletError } = await db.rpc("get_my_wallet"); if (walletError) throw walletError;
      const { data: transactions, error: txError } = await db.rpc("get_my_wallet_transactions", { p_limit: limit + 1, p_offset: offset }); if (txError) throw txError;
      const rows = Array.isArray(transactions) ? transactions : []; return { wallet: wallet ?? null, transactions: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(offset + limit) : null };
    }
  }
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  if (req.method === "OPTIONS") return json({ ok: true, request_id: requestId }, 200, requestId);
  if (req.method !== "POST") return errorEnvelope(requestId, "METHOD_NOT_ALLOWED", "POST required", 405);
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return errorEnvelope(requestId, "AUTH_REQUIRED", "Bearer authentication required", 401);
  const db = createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  let payload: { capability?: unknown; input?: unknown };
  try { payload = await req.json(); } catch { return errorEnvelope(requestId, "INVALID_JSON", "Request body must be JSON", 400); }
  const name = typeof payload.capability === "string" ? payload.capability : "";
  const definition = getCapability(name);
  if (!definition) return errorEnvelope(requestId, "CAPABILITY_NOT_FOUND", "Capability is not allowlisted", 404);
  if (definition.access === "authenticated") { try { await requireUser(db, requestId); } catch { return errorEnvelope(requestId, "AUTH_REQUIRED", "Authentication required", 401); } }
  const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input) ? payload.input as Record<string, unknown> : {};
  try {
    const data = await withServiceMetric(db, "capability-gateway", name, () => executeCapability(db, name as CapabilityName, input, requestId), { capability: name, request_id: requestId });
    return json({ ok: true, data, error: null, request_id: requestId }, 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : /REQUIRED|INVALID/.test(message) ? 400 : 500;
    const safe = message.startsWith("AUTH_REQUIRED") ? "Authentication required" : message.slice(0, 300);
    return errorEnvelope(requestId, status === 500 ? "CAPABILITY_EXECUTION_FAILED" : message.split(":")[0], safe, status);
  }
});
