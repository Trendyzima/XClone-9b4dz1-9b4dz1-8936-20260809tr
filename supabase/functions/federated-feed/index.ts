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
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store, max-age=0, must-revalidate" },
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
    const feedId = url.searchParams.get("feed_id");
    const userId = await getUserId(request);

    let followedActorUris: string[] = [];
    let followedHashtagIds: string[] = [];
    let followedHashtagTags: string[] = [];
    if (userId) {
      const { data: relationships } = await admin
        .from("federated_follow_relationships")
        .select("remote_actor_uri")
        .eq("local_user_id", userId)
        .in("state", ["pending", "accepted", "active"]);

      followedActorUris = [...new Set((relationships || [])
        .map((r: any) => String(r.remote_actor_uri || "").trim())
        .filter(Boolean))];

      const { data: hashtagFollows, error: hashtagFollowError } = await admin
        .from("hashtag_follows")
        .select("hashtag_id")
        .eq("user_id", userId);
      if (hashtagFollowError) throw hashtagFollowError;
      followedHashtagIds = [...new Set((hashtagFollows || [])
        .map((r: any) => String(r.hashtag_id || "").trim())
        .filter(Boolean))];

      if (followedHashtagIds.length) {
        const { data: followedHashtags, error: hashtagError } = await admin
          .from("hashtags")
          .select("id,tag")
          .in("id", followedHashtagIds);
        if (hashtagError) throw hashtagError;
        followedHashtagTags = (followedHashtags || [])
          .map((r: any) => String(r.tag || "").replace(/^#/, "").trim().toLowerCase())
          .filter(Boolean);
      }
    }

    const moderation = userId ? await Promise.all([
      admin.from("fediverse_domain_blocks").select("domain").eq("user_id", userId),
      admin.from("fediverse_content_filters").select("phrase,action,expires_at").eq("user_id", userId)
    ]) : [];
    const blockedDomains = new Set<string>((moderation[0]?.data || []).map((r:any)=>String(r.domain||"").toLowerCase().trim()).filter(Boolean));
    const activeFilters = (moderation[1]?.data || []).filter((r:any)=>!r.expires_at || new Date(r.expires_at).getTime()>Date.now());
    const moderationAllowed = (item:any) => {
      let domain = ""; try { domain = new URL(String(item.actor_uri||"")).hostname.toLowerCase(); } catch {}
      if (domain && blockedDomains.has(domain)) return false;
      const text = String(item.content||"").replace(/<[^>]*>/g," ").toLowerCase();
      return !activeFilters.some((f:any)=>{ const phrase=String(f.phrase||"").trim().toLowerCase(); return f.action==='hide' && phrase && text.includes(phrase); });
    };

    let customFeed:any=null;
    if(feedId && userId){ const fr=await admin.from("federated_custom_discovery_feeds").select("id,user_id,query,mode").eq("id",feedId).eq("user_id",userId).maybeSingle(); if(fr.error)throw fr.error; customFeed=fr.data||null; }
    const feedMatches=(item:any)=>{ if(!customFeed)return true; const mode=String(customFeed.mode||"all"); const body=String(item.content||"").replace(/<[^>]*>/g," ").toLowerCase(); const q=String(customFeed.query||"").trim().toLowerCase(); if(mode==="media" && !(Array.isArray(item.attachments)&&item.attachments.length))return false; if(mode==="people" && !item.actor_uri)return false; if(mode==="hashtags" && !Array.isArray(item.tags))return false; if(mode==="mentions" && !body.includes("@"))return false; if(mode==="conversations" && !item.in_reply_to_uri)return false; if(mode==="instances" && !item.actor_uri)return false; if(q){ const terms=q.split(/[,\s]+/).map((x:string)=>x.replace(/^#/, "").trim()).filter(Boolean); if(terms.length&&!terms.some((term:string)=>body.includes(term)||JSON.stringify(item.tags||[]).toLowerCase().includes(term)||String(item.actor_uri||"").toLowerCase().includes(term)))return false; } return true; };

    const baseSelect = "id,uri,object_type,actor_uri,instance_id,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,language_code,attachments,tags,like_count,announce_count,reply_count,quote_count,view_count,content_warning,raw_object";

    // A Follow only creates the relationship; it does not guarantee that a remote
    // instance has already delivered posts to our inbox. Hydrate followed actors
    // directly from their ActivityPub outbox so a newly-followed account can
    // contribute content to the personalized feed immediately.
    const hydratedActorAliases = new Set<string>(followedActorUris);

    const actorFallbackProfile = (actorUri: string, fallbackObject: any = null) => {
      const source = String(actorUri || fallbackObject?.attributedTo || fallbackObject?.actor || fallbackObject?.url || "").trim();
      let username = "";
      let domain = "";
      try {
        const parsed = new URL(source);
        domain = parsed.hostname;
        const parts = parsed.pathname.split("/").filter(Boolean);
        const markerIndex = parts.findIndex((part) => ["statuses", "objects", "notes"].includes(part));
        username = markerIndex > 0 ? parts[markerIndex - 1] : (parts.at(-1) || "");
        if (["ap", "users", "actors", "person"].includes(username)) username = "";
      } catch {}
      username = username || String(fallbackObject?.preferredUsername || fallbackObject?.username || "").trim() || "unknown";
      return { id: source, actor_uri: source, url: source, profile_url: source, username, preferredUsername: username, display_name: String(fallbackObject?.name || username), domain, bio: typeof fallbackObject?.summary === "string" ? fallbackObject.summary : null, avatar_url: null, header_url: null, followers_url: null, following_url: null, inbox_url: null, outbox_url: null, published_at: null, fields: [], emojis: [], followers_count: 0, following_count: 0 };
    };
    // Read path rule: never perform remote ActivityPub fetches or writes here.
    // Remote actor/object hydration belongs to the federation ingestion workers.
    // Keeping user reads database-only prevents N users from multiplying into
    // outbound HTTP fan-out and write amplification.
    const hydratedActorProfiles = new Map<string, any>();

    const loadStoredActorProfiles = async (uris: string[]) => {
      const uniqueUris = [...new Set(uris.map(String).filter(Boolean))];
      if (!uniqueUris.length) return;
      const { data, error } = await admin
        .from("federated_actors")
        .select("id,actor_uri,username,display_name,bio,avatar_url,header_url,profile_url,followers_count,following_count,fields,emojis")
        .in("actor_uri", uniqueUris)
        .limit(Math.min(uniqueUris.length, 100));
      if (error) throw error;
      for (const row of data ?? []) {
        const profile = {
          id: row.actor_uri,
          actor_uri: row.actor_uri,
          url: row.profile_url ?? row.actor_uri,
          profile_url: row.profile_url ?? row.actor_uri,
          username: row.username ?? "unknown",
          preferredUsername: row.username ?? "unknown",
          display_name: row.display_name ?? row.username ?? "unknown",
          domain: (() => { try { return new URL(String(row.actor_uri)).hostname; } catch { return ""; } })(),
          bio: row.bio ?? null,
          avatar_url: row.avatar_url ?? null,
          header_url: row.header_url ?? null,
          fields: Array.isArray(row.fields) ? row.fields : [],
          emojis: Array.isArray(row.emojis) ? row.emojis : [],
          followers_count: Number(row.followers_count ?? 0),
          following_count: Number(row.following_count ?? 0),
        };
        hydratedActorProfiles.set(String(row.actor_uri), profile);
      }
    };

    await loadStoredActorProfiles(followedActorUris);

    const enrichRemoteAccounts = async (items: any[]) => {
      const actorUris = [...new Set(items.flatMap((item: any) => {
        const raw = item.raw_object?.attributedTo;
        const rawUri = typeof raw === "string" ? raw : raw?.id;
        return [item.actor_uri, rawUri].filter(Boolean).map(String);
      }))].slice(0, 100);

      await loadStoredActorProfiles(actorUris);

      return items.map((item: any) => {
        const raw = item.raw_object?.attributedTo;
        const rawUri = typeof raw === "string" ? raw : raw?.id;
        const actorKey = String(item.actor_uri || rawUri || "");
        const profile = hydratedActorProfiles.get(actorKey)
          ?? hydratedActorProfiles.get(String(rawUri || ""))
          ?? actorFallbackProfile(actorKey || String(item.uri || ""), item.raw_object);
        return { ...item, remote_account: item.remote_account ?? profile, actor_uri: item.actor_uri || rawUri || profile.actor_uri };
      });
    };

    const buildQuery = () => {
      let query = admin
        .from("federated_objects")
        .select(baseSelect)
        .is("deleted_at", null)
        .eq("tombstone", false)
        .in("object_type", ["Note", "Article", "Question", "Video", "Image"])
        .gte("published_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (before) query = query.lt("published_at", new Date(before).toISOString());
      return query;
    };

    let followedActorItems: any[] = [];
    if (followedActorUris.length) {
      let followedQuery = admin
        .from("federated_objects")
        .select(baseSelect)
        .is("deleted_at", null)
        .eq("tombstone", false)
        .in("object_type", ["Note", "Article", "Question", "Video", "Image"])
        .gte("published_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .in("actor_uri", [...hydratedActorAliases])
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (before) followedQuery = followedQuery.lt("published_at", new Date(before).toISOString());
      const { data, error } = await followedQuery;
      if (error) throw error;
      followedActorItems = (data || []).filter(moderationAllowed).filter(feedMatches).map((item: any) => ({
        ...item,
        feed_source: "following_actor",
        remote_account: item.remote_account ?? hydratedActorProfiles.get(String(item.actor_uri)) ?? null,
      }));
    }

    let followedHashtagItems: any[] = [];
    if (followedHashtagIds.length) {
      const { data: mentions, error: mentionError } = await admin
        .from("federated_hashtag_mentions")
        .select("object_id,hashtag_id")
        .in("hashtag_id", followedHashtagIds)
        .limit(Math.min(200, Math.max(50, limit * 12)));
      if (mentionError) throw mentionError;

      const objectIds = [...new Set((mentions || []).map((m: any) => String(m.object_id || "")).filter(Boolean))];
      if (objectIds.length) {
        const { data: hashtagObjects, error: hashtagObjectsError } = await admin
          .from("federated_objects")
          .select(baseSelect)
          .is("deleted_at", null)
          .eq("tombstone", false)
          .in("object_type", ["Note", "Article", "Question", "Video", "Image"])
          .gte("published_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .in("id", objectIds)
          .order("published_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(limit * 3);

        if (hashtagObjectsError) throw hashtagObjectsError;
        const followedObjectSet = new Set(objectIds);
        const hashtagIdsByObject = new Map<string, string[]>();
        for (const mention of mentions || []) {
          const objectId = String(mention.object_id || "");
          if (!objectId) continue;
          const ids = hashtagIdsByObject.get(objectId) || [];
          ids.push(String(mention.hashtag_id || ""));
          hashtagIdsByObject.set(objectId, ids);
        }

        followedHashtagItems = (hashtagObjects || [])
          .filter(moderationAllowed)
          .filter(feedMatches)
          .map((item: any) => {
            const matchedIds = hashtagIdsByObject.get(String(item.id)) || [];
            const matchedTags = matchedIds.map((id) => {
              const index = followedHashtagIds.indexOf(id);
              return index >= 0 ? followedHashtagTags[index] : "";
            }).filter(Boolean);
            return {
              ...item,
              feed_source: "following_hashtag",
              followed_hashtags: [...new Set(matchedTags)],
              remote_account: item.remote_account ?? hydratedActorProfiles.get(String(item.actor_uri)) ?? null,
            };
          });
      }
    }

    const followedItems = [...followedActorItems, ...followedHashtagItems];
    const followedObjectIds = new Set(followedItems.map((item: any) => String(item.id || "")).filter(Boolean));
    const suggestedNeeded = Math.max(0, limit - followedItems.length);
    let suggestedItems: any[] = [];

    if (suggestedNeeded > 0) {
      const suggestedQuery = buildQuery();
      const { data, error } = await suggestedQuery;
      if (error) throw error;
      const followedSet = new Set(hydratedActorAliases);
      suggestedItems = (data || [])
        .filter((item: any) => !followedSet.has(String(item.actor_uri || "")) && !followedObjectIds.has(String(item.id || "")) && moderationAllowed(item) && feedMatches(item))
        .slice(0, suggestedNeeded)
        .map((item: any) => ({
          ...item,
          feed_source: "suggested",
          remote_account: item.remote_account ?? hydratedActorProfiles.get(String(item.actor_uri)) ?? null,
        }));
    }

    const enrichedItems = await enrichRemoteAccounts([...followedItems, ...suggestedItems]);
    const items = enrichedItems
      .sort((a, b) => {
        const sourcePriority = (source: string) =>
          source === "following_actor" ? 3 :
          source === "following_hashtag" ? 2 :
          source === "suggested" ? 1 : 0;
        const aFollowing = sourcePriority(a.feed_source);
        const bFollowing = sourcePriority(b.feed_source);
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
        followedHashtagCount: followedHashtagIds.length,
        followedHashtags: followedHashtagTags,
        followedActorPosts: followedActorItems.length,
        followedHashtagPosts: followedHashtagItems.length,
        followedPosts: followedItems.length,
        suggestedPosts: suggestedItems.length,
      },
    });
  } catch (error) {
    console.error("[federated-feed]", error);
    return json({ error: error instanceof Error ? error.message : "Federated feed failed" }, 500);
  }
});
