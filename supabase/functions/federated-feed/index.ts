import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=0, must-revalidate" },
});

function parseLimit(value: string | null): number {
  const n = Number.parseInt(value || "20", 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 20, 1), 50);
}

async function getUserId(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+/i.test(authorization)) return null;
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return json({ error: "GET required" }, 405);

  try {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const before = url.searchParams.get("before");
    const userId = await getUserId(request);

    let followedActorUris: string[] = [];
    if (userId) {
      const { data: relationships } = await admin
        .from("federated_relationships")
        .select("remote_actor_uri")
        .eq("local_user_id", userId)
        .eq("relationship", "following")
        .in("state", ["pending", "accepted", "active"]);

      followedActorUris = [...new Set((relationships || [])
        .map((r: any) => String(r.remote_actor_uri || "").trim())
        .filter(Boolean))];
    }

    const baseSelect = "id,uri,object_type,actor_uri,instance_id,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,language_code,attachments,tags,like_count,announce_count,reply_count,quote_count,view_count,content_warning,raw_object";

    const buildQuery = () => {
      let query = admin
        .from("federated_objects")
        .select(baseSelect)
        .is("deleted_at", null)
        .eq("tombstone", false)
        .in("object_type", ["Note", "Article", "Question", "Video", "Image"])
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (before) query = query.lt("published_at", new Date(before).toISOString());
      return query;
    };

    let followedItems: any[] = [];
    if (followedActorUris.length) {
      let followedQuery = admin
        .from("federated_objects")
        .select(baseSelect)
        .is("deleted_at", null)
        .eq("tombstone", false)
        .in("object_type", ["Note", "Article", "Question", "Video", "Image"])
        .in("actor_uri", followedActorUris)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (before) followedQuery = followedQuery.lt("published_at", new Date(before).toISOString());
      const { data, error } = await followedQuery;
      if (error) throw error;
      followedItems = (data || []).map((item: any) => ({ ...item, feed_source: "following" }));
    }

    const suggestedNeeded = Math.max(0, limit - followedItems.length);
    let suggestedItems: any[] = [];

    if (suggestedNeeded > 0) {
      const suggestedQuery = buildQuery();
      const { data, error } = await suggestedQuery;
      if (error) throw error;
      const followedSet = new Set(followedActorUris);
      suggestedItems = (data || [])
        .filter((item: any) => !followedSet.has(String(item.actor_uri || "")))
        .slice(0, suggestedNeeded)
        .map((item: any) => ({ ...item, feed_source: "suggested" }));
    }

    const items = [...followedItems, ...suggestedItems]
      .sort((a, b) => {
        const aFollowing = a.feed_source === "following" ? 1 : 0;
        const bFollowing = b.feed_source === "following" ? 1 : 0;
        if (aFollowing !== bFollowing) return bFollowing - aFollowing;
        return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
      })
      .slice(0, limit);

    const hasMore = followedItems.length >= limit || suggestedItems.length >= suggestedNeeded;
    const nextCursor = hasMore && items.length ? items[items.length - 1].published_at : null;

    return json({
      items,
      pagination: { limit, hasMore, nextCursor },
      personalization: {
        followingCount: followedActorUris.length,
        followedPosts: followedItems.length,
        suggestedPosts: suggestedItems.length,
      },
    });
  } catch (error) {
    console.error("[federated-feed]", error);
    return json({ error: error instanceof Error ? error.message : "Federated feed failed" }, 500);
  }
});
