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

function decodeCursor(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  try {
    const n = Number(atob(value));
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  } catch { return 0; }
}

function encodeCursor(offset: number): string { return btoa(String(offset)); }

async function requireUser(db: SupabaseClient, requestId: string) {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error(`AUTH_REQUIRED:${requestId}`);
  return data.user;
}

async function executeCapability(db: SupabaseClient, name: CapabilityName, input: Record<string, unknown>, requestId: string) {
  switch (name) {
    case "testagram.capabilities.list":
      return { capabilities: CAPABILITIES };

    case "testagram.health.read": {
      const { data, error } = await db.from("service_plane_health").select("service,events_24h,failures_24h,avg_duration_ms,last_event_at");
      if (error) throw error;
      return { services: data ?? [] };
    }

    case "testagram.posts.list": {
      await requireUser(db, requestId);
      const limit = pageSize(input.limit);
      const offset = decodeCursor(input.cursor);
      const { data, error } = await db.from("posts")
        .select("id,author_id,user_id,body,content,created_at,updated_at,media_url,media_type,media_count")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit);
      if (error) throw error;
      const rows = data ?? [];
      return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null };
    }

    case "testagram.posts.create": {
      const user = await requireUser(db, requestId);
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!body || body.length > 5000) throw new Error("INVALID_BODY");
      const communityId = typeof input.community_id === "string" ? input.community_id : null;
      const { data, error } = await db.from("posts").insert({
        author_id: user.id, user_id: user.id, body, content: body,
        community_id: communityId, media_count: 0, media_urls: [],
      }).select("id,author_id,user_id,body,content,community_id,created_at,updated_at").single();
      if (error) throw error;
      return { post: data };
    }

    case "testagram.search.posts": {
      await requireUser(db, requestId);
      const q = typeof input.q === "string" ? input.q.trim() : "";
      if (!q) throw new Error("QUERY_REQUIRED");
      const limit = pageSize(input.limit);
      const offset = decodeCursor(input.cursor);
      const { data, error } = await db.from("posts")
        .select("id,author_id,user_id,body,content,created_at,updated_at,media_url,media_type")
        .is("deleted_at", null)
        .or(`body.ilike.%${q}%,content.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit);
      if (error) throw error;
      const rows = data ?? [];
      return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null };
    }

    case "testagram.search.users": {
      await requireUser(db, requestId);
      const q = typeof input.q === "string" ? input.q.trim() : "";
      if (!q) throw new Error("QUERY_REQUIRED");
      const limit = pageSize(input.limit);
      const offset = decodeCursor(input.cursor);
      const { data, error } = await db.from("profiles")
        .select("id,username,display_name,avatar_url,bio,verified")
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .order("username", { ascending: true })
        .range(offset, offset + limit);
      if (error) throw error;
      const rows = data ?? [];
      return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null };
    }

    case "testagram.recommendations.generate": {
      const user = await requireUser(db, requestId);
      const { data, error } = await db.rpc("generate_content_recommendations", { p_user_id: user.id });
      if (error) throw error;
      return { recommendations: data ?? [] };
    }

    case "testagram.notifications.rank": {
      const user = await requireUser(db, requestId);
      const limit = pageSize(input.limit);
      const { data, error } = await db.rpc("rank_notifications", { p_user_id: user.id, p_limit: limit });
      if (error) throw error;
      return { items: data ?? [], next_cursor: null };
    }
  }
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  if (req.method === "OPTIONS") return json({ ok: true, request_id: requestId }, 200, requestId);
  if (req.method !== "POST") return errorEnvelope(requestId, "METHOD_NOT_ALLOWED", "POST required", 405);

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return errorEnvelope(requestId, "AUTH_REQUIRED", "Bearer authentication required", 401);

  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: { capability?: unknown; input?: unknown };
  try { payload = await req.json(); } catch { return errorEnvelope(requestId, "INVALID_JSON", "Request body must be JSON", 400); }

  const name = typeof payload.capability === "string" ? payload.capability : "";
  const definition = getCapability(name);
  if (!definition) return errorEnvelope(requestId, "CAPABILITY_NOT_FOUND", "Capability is not allowlisted", 404);
  if (definition.access === "authenticated") {
    try { await requireUser(db, requestId); } catch { return errorEnvelope(requestId, "AUTH_REQUIRED", "Authentication required", 401); }
  }
  const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input) ? payload.input as Record<string, unknown> : {};

  try {
    const data = await withServiceMetric(db, "capability-gateway", name, () => executeCapability(db, name as CapabilityName, input, requestId), {
      capability: name,
      request_id: requestId,
    });
    return json({ ok: true, data, error: null, request_id: requestId }, 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : /REQUIRED|INVALID/.test(message) ? 400 : 500;
    const safe = message.startsWith("AUTH_REQUIRED") ? "Authentication required" : message.slice(0, 300);
    return errorEnvelope(requestId, status === 500 ? "CAPABILITY_EXECUTION_FAILED" : message.split(":")[0], safe, status);
  }
});
