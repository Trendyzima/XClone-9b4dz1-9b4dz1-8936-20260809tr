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
    if (userId) {
      const { data: relationships } = await admin
        .from("federated_follow_relationships")
        .select("remote_actor_uri")
        .eq("local_user_id", userId)
        .in("state", ["pending", "accepted", "active"]);

      followedActorUris = [...new Set((relationships || [])
        .map((r: any) => String(r.remote_actor_uri || "").trim())
        .filter(Boolean))];
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

    // Keep the federated cache live: periodically pull public timelines from active
    // ActivityPub/Mastodon instances. This is intentionally bounded and non-blocking
    // for failures so one unhealthy remote server cannot break the feed.
    const refreshLiveInstances = async () => {
      const defaults = ["mastodon.social","fosstodon.org","mastodon.online","mastodon.world","hachyderm.io","infosec.exchange","mas.to","mstdn.social"];
      const actorRows = await admin.from("federated_actors").select("domain").not("domain","is",null).order("updated_at",{ascending:false}).limit(24);
      const domains = [...new Set([...defaults,...(actorRows.data||[]).map((r:any)=>String(r.domain||"").trim().toLowerCase()).filter((d:string)=>/^[a-z0-9.-]+$/.test(d))])].slice(0,16);
      const state = await admin.from("fediverse_instance_sync_state").select("domain,last_synced_at").in("domain",domains);
      const stateMap = new Map((state.data||[]).map((r:any)=>[String(r.domain),Date.parse(r.last_synced_at||"1970-01-01")]));
      const now=Date.now();
      const due=domains.filter((d:string)=>now-(stateMap.get(d)||0)>45_000);
      await Promise.allSettled(due.map(async(domain:string)=>{
        try{
          const res=await fetch(`https://${domain}/api/v1/timelines/public?limit=30&local=true`,{headers:{Accept:"application/json","User-Agent":"Testagram-Federation/4.0"},signal:AbortSignal.timeout(7000)});
          if(!res.ok)throw new Error(`HTTP ${res.status}`);
          const statuses=await res.json();
          const rows=(Array.isArray(statuses)?statuses:[]).map((s:any)=>{
            const acct=s.account||{}; const actor=String(acct.url||acct.uri||`https://${domain}/users/${acct.username||"unknown"}`);
            const uri=String(s.uri||s.url||""); if(!uri)return null;
            return {uri,object_type:"Note",actor_uri:actor,url:s.url||uri,content:String(s.content||""),summary:s.spoiler_text||null,published_at:s.created_at||new Date().toISOString(),updated_at:s.edited_at||s.created_at||null,sensitive:Boolean(s.sensitive),in_reply_to_uri:s.in_reply_to_id?String(s.in_reply_to_id):null,quote_uri:s.quote_id?String(s.quote_id):null,attachments:Array.isArray(s.media_attachments)?s.media_attachments:[],tags:Array.isArray(s.tags)?s.tags:[],like_count:Number(s.favourites_count||0),announce_count:Number(s.reblogs_count||0),reply_count:Number(s.replies_count||0),quote_count:Number(s.quotes_count||0),view_count:Number(s.view_count||0),content_warning:s.spoiler_text||null,raw_object:s,remote_account:{id:actor,actor_uri:actor,url:acct.url||actor,username:acct.username||"unknown",preferredUsername:acct.username||"unknown",display_name:acct.display_name||acct.username||"unknown",domain,avatar_url:acct.avatar||null,header_url:acct.header||null,bio:acct.note||null,followers_count:Number(acct.followers_count||0),following_count:Number(acct.following_count||0),profile_url:acct.url||actor}};
          }).filter(Boolean);
          if(rows.length){const ins=await admin.from("federated_objects").upsert(rows,{onConflict:"uri",ignoreDuplicates:false});if(ins.error)throw ins.error;}
          await admin.from("fediverse_instance_sync_state").upsert({domain,last_synced_at:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()},{onConflict:"domain"});
        }catch(error){await admin.from("fediverse_instance_sync_state").upsert({domain,last_synced_at:new Date().toISOString(),last_error:error instanceof Error?error.message:"sync failed",updated_at:new Date().toISOString()},{onConflict:"domain"});}
      }));
    };
    await refreshLiveInstances();

    const baseSelect = "id,uri,object_type,actor_uri,instance_id,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,language_code,attachments,tags,like_count,announce_count,reply_count,quote_count,view_count,content_warning,raw_object";

    // A Follow only creates the relationship; it does not guarantee that a remote
    // instance has already delivered posts to our inbox. Hydrate followed actors
    // directly from their ActivityPub outbox so a newly-followed account can
    // contribute content to the personalized feed immediately.
    const hydratedActorAliases = new Set<string>(followedActorUris);
    const hydratedActorProfiles = new Map<string, any>();

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
    const hydrateActor = async (actorUri: string) => {
      try {
        const actorUrl = new URL(actorUri);
        if (!["http:", "https:"].includes(actorUrl.protocol)) return;
        const actorRes = await fetch(actorUrl.toString(), {
          headers: { Accept: "application/activity+json, application/ld+json", "User-Agent": "Testagram-Federation/4.0" },
        });
        if (!actorRes.ok) return;
        const actor = await actorRes.json();
        const actorId = String(actor.id ?? actorUri);
        hydratedActorAliases.add(actorId);
        hydratedActorAliases.add(actorUri);
        const actorHost = (() => { try { return new URL(actorId).hostname; } catch { return actorUrl.hostname; } })();
        const remoteAccount = {
          id: actorId,
          actor_uri: actorId,
          url: typeof actor.url === "string" ? actor.url : actorId,
          username: String(actor.preferredUsername ?? actor.username ?? actorId.split("/").pop() ?? "unknown"),
          preferredUsername: String(actor.preferredUsername ?? actor.username ?? actorId.split("/").pop() ?? "unknown"),
          display_name: String(actor.name ?? actor.preferredUsername ?? actor.username ?? "unknown"),
          domain: actorHost,
          bio: typeof actor.summary === "string" ? actor.summary : null,
          avatar_url: typeof actor.icon === "string" ? actor.icon : actor.icon?.url ?? actor.icon?.href ?? null,
          header_url: typeof actor.image === "string" ? actor.image : actor.image?.url ?? actor.image?.href ?? null,
          followers_url: typeof actor.followers === "string" ? actor.followers : actor.followers?.id ?? null,
          following_url: typeof actor.following === "string" ? actor.following : actor.following?.id ?? null,
          inbox_url: typeof actor.inbox === "string" ? actor.inbox : actor.inbox?.id ?? null,
          outbox_url: typeof actor.outbox === "string" ? actor.outbox : actor.outbox?.id ?? null,
          published_at: actor.published ?? null,
          profile_url: typeof actor.url === "string" ? actor.url : actor.url?.href ?? actorId,
          fields: Array.isArray(actor.attachment) ? actor.attachment.filter((x: any) => x?.type === "PropertyValue").map((x: any) => ({ name: String(x.name ?? ""), value: String(x.value ?? "") })) : [],
          emojis: Array.isArray(actor.tag) ? actor.tag : [],
          followers_count: Number(actor.followers?.totalItems ?? 0),
          following_count: Number(actor.following?.totalItems ?? 0),
        };
        hydratedActorProfiles.set(actorId, remoteAccount);
        hydratedActorProfiles.set(actorUri, remoteAccount);
        const outboxUrl = typeof actor.outbox === "string" ? actor.outbox : actor.outbox?.id;
        if (!outboxUrl) return;

        const fetchCollectionPage = async (collectionUrl: string) => {
          const response = await fetch(collectionUrl, {
            headers: { Accept: "application/activity+json, application/ld+json" },
          });
          if (!response.ok) return null;
          return await response.json();
        };

        const outbox = await fetchCollectionPage(outboxUrl);
        if (!outbox) return;

        let entries = Array.isArray(outbox.orderedItems)
          ? outbox.orderedItems
          : Array.isArray(outbox.items)
            ? outbox.items
            : [];

        // Mastodon/Fediverse servers commonly expose an OrderedCollection whose
        // posts live on the first page rather than directly on the collection.
        if (!entries.length) {
          const firstPage = typeof outbox.first === "string"
            ? outbox.first
            : outbox.first?.id;
          if (firstPage) {
            const page = await fetchCollectionPage(firstPage);
            entries = Array.isArray(page?.orderedItems)
              ? page.orderedItems
              : Array.isArray(page?.items)
                ? page.items
                : [];
          }
        }
        const rawEntries = entries.slice(0, 30);
        const objects = (await Promise.all(rawEntries.map(async (entry: any) => {
          const candidate = entry?.object ?? entry;
          if (candidate && typeof candidate === "object") return candidate;
          if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
            try {
              const response = await fetchCollectionPage(candidate);
              return response && typeof response === "object" ? response : null;
            } catch { return null; }
          }
          return null;
        })))
          .filter((object: any) => object && object.type !== "Delete")
          .filter((object: any) => ["Note", "Article", "Question", "Video", "Image"].includes(object.type))
          .slice(0, 20);

        if (!objects.length) return;
        const rows = objects.map((object: any) => ({
          uri: String(object.id ?? object.url ?? ""),
          object_type: String(object.type ?? "Note"),
          // Always store the fetched actor's canonical ID. The follow relationship
          // may contain an alias/alternate actor URL, while Mastodon Notes commonly
          // point at the actor ID. Keeping one canonical actor_uri prevents the
          // personalized query from dropping otherwise valid posts.
          actor_uri: actorId,
          url: typeof object.url === "string" ? object.url : (object.url?.href ?? object.id ?? null),
          content: String(object.content ?? object.name ?? ""),
          summary: object.summary ?? null,
          attachments: Array.isArray(object.attachment) ? object.attachment : [],
          tags: Array.isArray(object.tag) ? object.tag : [],
          like_count: Number(object.likes?.totalItems ?? 0),
          announce_count: Number(object.shares?.totalItems ?? 0),
          reply_count: Number(object.replies?.totalItems ?? 0),
          published_at: object.published ?? object.updated ?? new Date().toISOString(),
          raw_object: object,
          remote_account: remoteAccount,
        })).filter((row: any) => row.uri);

        if (rows.length) {
          await admin.from("federated_objects").upsert(rows, { onConflict: "uri", ignoreDuplicates: false });
        }
      } catch (error) {
        const fallback = actorFallbackProfile(actorUri);
        hydratedActorProfiles.set(actorUri, fallback);
        hydratedActorAliases.add(actorUri);
        console.warn("[federated-feed] actor hydration failed; using URI fallback", actorUri, error);
      }
    };

    if (followedActorUris.length) {
      const hydrateQueue = followedActorUris.slice(0, 27);
      const concurrency = 5;
      for (let i = 0; i < hydrateQueue.length; i += concurrency) {
        await Promise.all(hydrateQueue.slice(i, i + concurrency).map(hydrateActor));
      }
    }

    const enrichRemoteAccounts = async (items: any[]) => {
      const actorUris = [...new Set(items.flatMap((item: any) => {
        const raw = item.raw_object?.attributedTo;
        const rawUri = typeof raw === "string" ? raw : raw?.id;
        return [item.actor_uri, rawUri].filter(Boolean).map(String);
      }))];
      await Promise.all(actorUris.slice(0, 30).map(async (uri) => {
        if (!hydratedActorProfiles.has(uri)) await hydrateActor(uri);
      }));
      return items.map((item: any) => {
        const raw = item.raw_object?.attributedTo;
        const rawUri = typeof raw === "string" ? raw : raw?.id;
        const profile = hydratedActorProfiles.get(String(item.actor_uri || "")) ?? hydratedActorProfiles.get(String(rawUri || "")) ?? actorFallbackProfile(String(item.actor_uri || rawUri || item.uri || ""), raw);
        return { ...item, remote_account: profile, actor_uri: item.actor_uri || rawUri || profile.actor_uri };
      });
    };

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
.in("actor_uri", [...hydratedActorAliases])
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (before) followedQuery = followedQuery.lt("published_at", new Date(before).toISOString());
      const { data, error } = await followedQuery;
      if (error) throw error;
      followedItems = (data || []).filter(moderationAllowed).filter(feedMatches).map((item: any) => ({
        ...item,
        feed_source: "following",
        remote_account: item.remote_account ?? hydratedActorProfiles.get(String(item.actor_uri)) ?? null,
      }));
    }

    const suggestedNeeded = Math.max(0, limit - followedItems.length);
    let suggestedItems: any[] = [];

    if (suggestedNeeded > 0) {
      const suggestedQuery = buildQuery();
      const { data, error } = await suggestedQuery;
      if (error) throw error;
      const followedSet = new Set(hydratedActorAliases);
      suggestedItems = (data || [])
        .filter((item: any) => !followedSet.has(String(item.actor_uri || "")) && moderationAllowed(item) && feedMatches(item))
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
