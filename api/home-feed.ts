import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

const ALLOWED_ORIGINS = new Set([
  'https://testagram.site',
  'https://www.testagram.site',
]);

function corsHeaders(request: RequestLike) {
  const origin = header(request, 'origin');
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://testagram.site';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, accept, x-request-id, x-supabase-api-version, x-retry-count, traceparent, tracestate, baggage',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Authorization, Origin',
  };
}

const json = (body: unknown, status = 200, request?: RequestLike) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders(request || {}),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, max-age=2, stale-while-revalidate=10',
  },
});

type RequestLike = Request | { headers?: Headers | Record<string, string | string[] | undefined>; url?: string; };

function header(request: RequestLike, name: string) {
  const headers = request.headers;
  if (!headers) return '';
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) || '';
  const value = (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

async function authenticate(request: RequestLike) {
  const authorization = header(request, 'authorization');
  if (!/^Bearer\s+/i.test(authorization) || !SUPABASE_ANON_KEY) return null;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ? { id: data.user.id, token } : null;
}

function requestUrl(request: RequestLike) {
  return typeof request.url === 'string' && request.url ? request.url : 'https://testagram.site/api/home-feed';
}

function sourceKey(item: any) {
  return String(item.type) + ':' + String(item.data?.id ?? item.data?.uri ?? '');
}

function candidateScore(item: any) {
  const d = item?.data || {};
  const affinity = Number(item.affinityScore ?? d.affinity_score ?? 0);
  const ageHours = Math.max(0, (Date.now() - new Date(d.created_at || 0).getTime()) / 3600000);
  const engagement = Math.log1p(Math.max(0, Number(d.likes_count ?? 0))) * 1.8
    + Math.log1p(Math.max(0, Number(d.replies_count ?? 0))) * 1.4
    + Math.log1p(Math.max(0, Number(d.reposts_count ?? 0))) * 2.2
    + Math.log1p(Math.max(0, Number(d.views_count ?? 0))) * 0.2;
  const freshness = Math.exp(-ageHours / 36) * 12;
  const sourceBoost = ['following-local','following-thread','following-federated','following-community','following-hashtag-local'].includes(item.source) ? 12
    : item.source === 'recommendation' ? 8 : item.source === 'thread' ? 3 : 0;
  // Remote discovery must compete on equal footing with local discovery.
  // Followed federation gets the strongest signal; fresh public federation still
  // receives a meaningful boost instead of the historical zero-affinity score.
  const federationBoost = item.source === 'following-federated' ? 16 : item.source === 'federated' ? 10 : 0;
  const creditBoost = Math.min(12, Math.max(0, Number(d.credit_boost_score ?? 0)));
  return affinity + sourceBoost + federationBoost + freshness + engagement + Number(d.recommendation_score ?? 0) * 5 + creditBoost;
}

function blend(items: any[], limit: number) {
  const eligible = items.filter((x) => x?.data?.created_at);
  const ranked = [...eligible].sort((a, b) =>
    candidateScore(b) - candidateScore(a) ||
    new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());

  // X-style ranking: affinity is a priority signal, not a separate silo.
  // Followed people/communities/hashtags get a strong head start, while
  // freshness, engagement and discovery candidates can still outrank weak
  // affinity content. The composer deliberately mixes the lanes instead of
  // dumping all followed content at the top.
  const priority = ranked.filter((x) => Number(x.affinityScore ?? 0) >= 20);
  const discovery = ranked.filter((x) => Number(x.affinityScore ?? 0) < 20);
  const out: any[] = [];
  const used = new Set<string>();
  let p = 0;
  let d = 0;
  let prioritySlots = 0;

  // Target roughly 60% affinity-driven content, with discovery continuously
  // mixed in. If affinity candidates are scarce, discovery fills the gap.
  while (out.length < limit && (p < priority.length || d < discovery.length)) {
    const shouldPriority = prioritySlots < Math.ceil(limit * 0.6) &&
      p < priority.length &&
      (out.length % 3 !== 2 || d >= discovery.length);

    const pool = shouldPriority ? priority : discovery;
    let chosen = pool === priority ? priority[p++] : discovery[d++];
    if (!chosen) continue;

    const key = sourceKey(chosen);
    if (used.has(key)) continue;

    // Avoid monotonous runs from the same surface/author while preserving
    // strong follow affinity.
    const recent = out.slice(-2);
    const chosenAuthor = String(chosen.data?.author_id || chosen.data?.user_id || chosen.data?.owner_id || '');
    const sameAuthor = chosenAuthor && recent.filter((x) =>
      String(x.data?.author_id || x.data?.user_id || x.data?.owner_id || '') === chosenAuthor).length >= 2;
    const sameSource = recent.filter((x) => String(x.data?.feed_source || x._source || '') === String(chosen.source || '')).length >= 2;
    if (sameAuthor || sameSource) continue;

    used.add(key);
    out.push({ type: chosen.type, data: { ...chosen.data, feed_source: chosen.source } });
    if (shouldPriority) prioritySlots += 1;
  }


  return out.slice(0, limit);
}

function injectFollowing(discovery: any[], following: any[], limit: number) {
  // Following content—including followed Fediverse actors—enters the same
  // ranking as local discovery, but with a materially higher affinity score.
  // The blend function guarantees a remote item when federation has candidates.
  const all = [...following, ...discovery];
  const deduped: any[] = [];
  const seen = new Set<string>();

  for (const item of all) {
    const key = sourceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return blend(deduped, limit);
}

export default async function handler(request: RequestLike) {
  const method = typeof (request as Request).method === 'string' ? (request as Request).method : '';
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (method !== 'GET') return json({ error: 'GET required' }, 405, request);
  const started = Date.now();

  try {
    // Home is a public discovery surface. Authentication enriches the feed with
    // follows/recommendations, but must never be a prerequisite for rendering
    // public posts, threads, or stored Fediverse content.
    const auth = await authenticate(request);
    // The home feed is read-only and must remain available even when the
    // privileged service-role secret is intentionally absent from a Worker.
    // Use the service role when provisioned; otherwise use the publishable key
    // with the verified user's JWT so Supabase RLS remains the authorization
    // boundary. Never require a service-role secret for public feed rendering.
    const databaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    if (!databaseKey) return json({ error: 'Home feed backend is not configured' }, 503, request);

    const url = new URL(requestUrl(request));
    const limit = Math.max(4, Math.min(8, Math.floor(Number(url.searchParams.get('limit') || 6))));
    const before = url.searchParams.get('before');
    let cursor: { post?: string; thread?: string; fed?: string | null } = {};
    if (before) {
      try {
        const decoded = JSON.parse(atob(before));
        if (decoded && typeof decoded === 'object') cursor = decoded;
      } catch {
        return json({ error: 'Invalid feed cursor' }, 400, request);
      }
    }

    const admin = createClient(SUPABASE_URL, databaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: auth && !SUPABASE_SERVICE_ROLE_KEY
        ? { headers: { Authorization: 'Bearer ' + auth.token } }
        : undefined,
    });

    // Following is a first-class feed lane. A successful local or federated follow
    // must immediately influence what the user sees; it must not wait for a
    // recommendation batch or a model refresh.
    // Anonymous WebView sessions are valid for the public home feed. Only query
    // private follow relationships when a verified Supabase user is present.
    const { data: localFollowRows, error: localFollowError } = auth
      ? await admin
          .from('follows')
          .select('following_id,status')
          .eq('follower_id', auth.id)
      : { data: [], error: null };
    if (localFollowError) console.warn('[home-feed] local follows', localFollowError);
    const followedLocalIds = [...new Set((localFollowRows || [])
      .filter((row: any) => !row.status || ['accepted','active','following'].includes(String(row.status).toLowerCase()))
      .map((row: any) => String(row.following_id || ''))
      .filter(Boolean))];

    // Expand the affinity graph beyond people: local hashtag follows and
    // joined communities are first-class interests and should influence Home
    // immediately, just like followed accounts and federated follows.
    const [hashtagFollowRows, communityMemberRows] = auth
      ? await Promise.all([
          admin.from('hashtag_follows').select('hashtag_id').eq('user_id', auth.id).limit(100),
          admin.from('community_members').select('community_id,status').eq('user_id', auth.id).limit(100),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    const followedHashtagIds = [...new Set((hashtagFollowRows.data || []).map((r: any) => String(r.hashtag_id || '')).filter(Boolean))];
    const joinedCommunityIds = [...new Set((communityMemberRows.data || [])
      .filter((r: any) => !r.status || ['active','accepted','member'].includes(String(r.status).toLowerCase()))
      .map((r: any) => String(r.community_id || '')).filter(Boolean))];

    const sourceLimit = Math.max(6, Math.ceil(limit * 2));
    const recommendationQuery = auth
      ? admin.from('content_recommendations')
        .select('recommended_post_id,score,reason,source')
        .eq('user_id', auth.id).eq('shown', false)
        .order('score', { ascending: false }).limit(sourceLimit)
      : Promise.resolve({ data: [], error: null });

    const postsQuery = admin.from('posts')
      .select('*, user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
      .is('community_id', null).is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(sourceLimit);
    const followingPostsQuery = followedLocalIds.length
      ? admin.from('posts')
        .select('*, user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .is('community_id', null).is('deleted_at', null)
        .in('author_id', followedLocalIds)
        .order('created_at', { ascending: false })
        .limit(sourceLimit)
      : null;
    const threadsQuery = admin.from('threads')
      .select('*')
      .eq('visibility', 'public').is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(sourceLimit);
    const followingThreadsQuery = followedLocalIds.length
      ? admin.from('threads').select('*').eq('visibility','public').is('deleted_at',null)
        .in('owner_id', followedLocalIds).order('created_at',{ascending:false}).limit(sourceLimit)
      : null;

    const followedHashtagPostsQuery = followedHashtagIds.length
      ? admin.from('post_hashtags')
        .select('post_id,hashtags!inner(id,tag)')
        .in('hashtag_id', followedHashtagIds.slice(0, 100))
        .limit(sourceLimit * 3)
      : null;
    const communityPostsQuery = joinedCommunityIds.length
      ? admin.from('posts')
        .select('*, user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .in('community_id', joinedCommunityIds.slice(0, 100))
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(sourceLimit)
      : null;

    if (cursor.post) {
      postsQuery.lt('created_at', cursor.post);
      followingPostsQuery?.lt('created_at', cursor.post);
      communityPostsQuery?.lt('created_at', cursor.post);
    }
    if (cursor.thread) { threadsQuery.lt('created_at', cursor.thread); followingThreadsQuery?.lt('created_at', cursor.thread); }

    const includeFederated = url.searchParams.get('includeFederated') !== '0';
    const fedQuery = new URLSearchParams({ limit: String(sourceLimit) });
    if (cursor.fed) fedQuery.set('before', cursor.fed);

    const federationStarted = Date.now();
    const federatedPromise = includeFederated
      ? (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6500);
          try {
            const response = await fetch(SUPABASE_URL + '/functions/v1/federated-feed?' + fedQuery, {
              headers: auth
                ? { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + auth.token }
                : { apikey: SUPABASE_ANON_KEY },
              signal: controller.signal,
            });
            if (!response.ok) {
              console.warn('[home-feed] federated source http', response.status);
              return { items: [], pagination: { hasMore: false, nextCursor: null }, _meta: { error: `http_${response.status}` } };
            }
            const payload = await response.json();
            return { ...payload, _meta: { ...(payload?._meta || {}), latencyMs: Date.now() - federationStarted } };
          } catch (error) {
            console.warn('[home-feed] federated source degraded', error);
            return { items: [], pagination: { hasMore: false, nextCursor: null }, _meta: { error: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'fetch_error', message: String(error) } };
          } finally {
            clearTimeout(timer);
          }
        })()
      : Promise.resolve({ items: [], pagination: { hasMore: false, nextCursor: null } });

    const [recommendationResult, postsResult, followingPostsResult, threadsResult, followingThreadsResult, followedHashtagPostsResult, communityPostsResult, fedResult] = await Promise.all([
      recommendationQuery,
      postsQuery,
      followingPostsQuery || Promise.resolve({ data: [], error: null }),
      threadsQuery,
      followingThreadsQuery || Promise.resolve({ data: [], error: null }),
      followedHashtagPostsQuery || Promise.resolve({ data: [], error: null }),
      communityPostsQuery || Promise.resolve({ data: [], error: null }),
      federatedPromise,
    ]);
    // Organic discovery is intentionally outside the critical Home feed path.
    // Home renders the first local/following/federated page immediately; the reusable
    // discovery component loads one candidate after the shell has painted.

    if (postsResult.error) {
      // Do not let a stale/mismatched PostgREST relationship cache turn a
      // healthy public feed into an empty response. Retry the post query without
      // the nested profile relationship, then hydrate profiles separately.
      console.error('[home-feed] posts joined query', postsResult.error);
      let fallbackPostsQuery = admin.from('posts')
        .select('*')
        .is('community_id', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(sourceLimit);
      if (cursor.post) fallbackPostsQuery = fallbackPostsQuery.lt('created_at', cursor.post);
      const fallbackPosts = await fallbackPostsQuery;
      if (!fallbackPosts.error) {
        const authorIds = [...new Set((fallbackPosts.data || [])
          .map((p: any) => String(p.author_id || p.user_id || ''))
          .filter(Boolean))];
        const profileMap = new Map<string, any>();
        if (authorIds.length) {
          const profileResult = await admin.from('profiles')
            .select('id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at')
            .in('id', authorIds);
          if (!profileResult.error) for (const profile of profileResult.data || []) profileMap.set(String(profile.id), profile);
        }
        (postsResult as any).data = (fallbackPosts.data || []).map((post: any) => ({
          ...post,
          user_profiles: profileMap.get(String(post.author_id || post.user_id || '')) || {},
        }));
        (postsResult as any).error = null;
      }
    }
    if (threadsResult.error) console.error('[home-feed] threads', threadsResult.error);

    type RecommendationRow = {
      recommended_post_id: string;
      score?: number | null;
      reason?: string | null;
      source?: string | null;
    };
    const recommendationRows: RecommendationRow[] = Array.isArray(recommendationResult.data)
      ? recommendationResult.data as RecommendationRow[]
      : [];
    const recommendedIds = [...new Set(recommendationRows.map((r) => String(r.recommended_post_id || '')).filter(Boolean))];
    const recommendedResult = recommendedIds.length
      ? await admin.from('posts')
        .select('*, user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .in('id', recommendedIds).is('community_id', null).is('deleted_at', null).limit(sourceLimit)
      : { data: [], error: null };
    if (cursor.post && recommendedResult.data) {
      (recommendedResult as any).data = recommendedResult.data.filter((post: any) => String(post.created_at || '') < cursor.post!);
    }
    const feedPostIds = [...(postsResult.data || []), ...(followingPostsResult.data || []), ...(recommendedResult.data || []), ...(communityPostsResult.data || []), ...((followedHashtagPostsResult.data || []).map((r: any) => ({ id: r.post_id })))]
      .map((p: any) => String(p.id || ''))
      .filter(Boolean);

    // Credits boosts are a ranking signal on the same Home candidate pool.
    // The read-only RPC exposes only active boost scores for IDs already in this page,
    // so the feed never trusts browser-controlled boost flags and never needs service-role access.
    const creditBoostPostIds = [...new Set(feedPostIds)].filter(Boolean);
    const creditBoostProfileIds = [...new Set(
      [...(postsResult.data || []), ...(followingPostsResult.data || []), ...(recommendedResult.data || []), ...(communityPostsResult.data || [])]
        .map((p: any) => String(p.author_id || p.user_id || ''))
        .filter(Boolean)
    )];
    const { data: creditBoostRows, error: creditBoostError } = creditBoostPostIds.length || creditBoostProfileIds.length
      ? await admin.rpc('get_credit_boost_bonuses', {
          p_source_ids: creditBoostPostIds,
          p_profile_ids: creditBoostProfileIds,
        })
      : { data: [], error: null };
    if (creditBoostError) console.warn('[home-feed] credits boosts', creditBoostError);
    const creditBoostByKey = new Map<string, number>();
    for (const row of creditBoostRows || []) {
      creditBoostByKey.set(String(row.source_type) + ':' + String(row.source_id), Number(row.bonus || 0));
    }
    const applyCreditBoost = (post: any) => {
      const postId = String(post.id || '');
      const profileId = String(post.author_id || post.user_id || '');
      const score = (creditBoostByKey.get('post:' + postId) || 0) + (creditBoostByKey.get('profile:' + profileId) || 0);
      return score > 0 ? { ...post, credit_boost_score: Math.min(12, score), is_credit_boosted: true, boost_label: 'Boosted' } : post;
    };
    const pollByPostId = new Map<string, any>();
    if (feedPostIds.length) {
      const { data: pollRows, error: pollError } = await admin
        .from('polls')
        .select('id,post_id,question,description,status,ends_at,allow_multiple,visibility')
        .in('post_id', feedPostIds)
        .eq('visibility', 'public');
      if (pollError) console.warn('[home-feed] polls', pollError);
      for (const poll of (pollRows || [])) {
        if (poll?.post_id) pollByPostId.set(String(poll.post_id), poll);
      }
    }

    const recommendationById = new Map<string, RecommendationRow>(
      recommendationRows.map((r): [string, RecommendationRow] => [String(r.recommended_post_id), r])
    );
    const recommendations = (recommendedResult.data || []).map((p: any) => {
      const r = recommendationById.get(String(p.id));
      return { type: 'post', source: 'recommendation', data: { ...applyCreditBoost(p), is_federated: false,
        feed_reason: r?.reason || 'Recommended for you', recommendation_score: Number(r?.score || 0) } };
    });

    const followingLocal = (followingPostsResult.data || []).map((p: any) => ({
      type: 'post', source: 'following-local', affinityScore: 48,
      data: { ...applyCreditBoost(p), poll: pollByPostId.get(String(p.id)) ?? null, is_federated: false, feed_reason: 'From someone you follow' },
    }));
    const local = (postsResult.data || [])
      .filter((p: any) => !followedLocalIds.includes(String(p.author_id || p.user_id || '')))
      .map((p: any) => ({ type: 'post', source: 'local', data: { ...applyCreditBoost(p), poll: pollByPostId.get(String(p.id)) ?? null, is_federated: false } }));
    const followingThreads = (followingThreadsResult.data || []).map((t: any) => ({
      type: 'thread', source: 'following-thread', affinityScore: 42,
      data: { ...t, is_federated: false, feed_reason: 'From someone you follow' },
    }));

    const followingHashtagPostIds = [...new Set((followedHashtagPostsResult.data || [])
      .map((r: any) => String(r.post_id || '')).filter(Boolean))];
    let followedHashtagQuery = followingHashtagPostIds.length
      ? admin.from('posts')
          .select('*, user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
          .in('id', followingHashtagPostIds.slice(0, sourceLimit * 2))
          .is('community_id', null).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(sourceLimit)
      : null;
    if (cursor.post) followedHashtagQuery = followedHashtagQuery?.lt('created_at', cursor.post) ?? null;
    const followedHashtagPosts = followedHashtagQuery
      ? (await followedHashtagQuery).data || []
      : [];
    const followedHashtagItems = followedHashtagPosts.map((p: any) => ({
      type: 'post', source: 'following-hashtag-local', affinityScore: 34,
      data: { ...applyCreditBoost(p), is_federated: false, feed_reason: 'From a hashtag you follow' },
    }));

    const followingCommunity = (communityPostsResult.data || []).map((p: any) => ({
      type: 'post', source: 'following-community', affinityScore: 38,
      data: { ...applyCreditBoost(p), is_federated: false, feed_reason: 'From a community you joined' },
    }));
    const threads = (threadsResult.data || [])
      .filter((t: any) => !followedLocalIds.includes(String(t.owner_id || '')))
      .map((t: any) => ({ type: 'thread', source: 'thread', data: { ...t, is_federated: false } }));
    const fedItems = Array.isArray(fedResult?.items) ? fedResult.items : [];

    const fed = fedItems.map((p: any) => ({
      type: 'fedpost',
      source: p.feed_source === 'following_actor' || p.feed_source === 'following_hashtag' ? 'following-federated' : 'federated',
      affinityScore: p.feed_source === 'following_actor' || p.feed_source === 'following_hashtag' ? 58 : 14,
      data: {
        ...p,
        id: p.id ?? p.uri,
        content: p.content ?? p.text ?? '',
        created_at: p.created_at ?? p.published_at ?? p.published,
        user_profiles: p.user_profiles ?? p.remote_account ?? p.actor ?? p.account ?? p.author ?? {},
        media_urls: p.media_urls ?? p.mediaUrls ?? p.attachments ?? [],
        image_url: p.image_url ?? p.preview_image_url ?? p.thumbnail_url,
        video_url: p.video_url ?? p.videoUrl,
        is_video: Boolean(p.is_video || p.video_url || p.videoUrl),
        is_federated: true,
        is_federated_discovery: true,
      },
    }));

    const followed = [
      ...followingLocal,
      ...followingThreads,
      ...followedHashtagItems,
      ...followingCommunity,
      ...fed.filter((item: any) => item.source === 'following-federated'),
    ];
    const discovery = [...recommendations, ...local, ...threads, ...fed.filter((item: any) => item.source !== 'following-federated')];

    // Credit boosts are an organic-ranking signal, not a separate ad lane.
    // The canonical credit boost ledger owns eligibility, caps, idempotency and spend.
    // Home only consumes the server-calculated bonus.
    let creditBoostBonusRows: any[] = [];
    if (SUPABASE_SERVICE_ROLE_KEY) {
      const localCandidates = [...followed, ...discovery].filter((item: any) =>
        item?.type === 'post' || item?.type === 'poll'
      );
      const sourceIds = [...new Set(localCandidates
        .map((item: any) => String(item.data?.id || ''))
        .filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)))];
      const profileIds = [...new Set(localCandidates
        .map((item: any) => String(item.data?.author_id || item.data?.user_id || item.data?.owner_id || ''))
        .filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)))];
      if (sourceIds.length || profileIds.length) {
        const { data, error } = await admin.rpc('get_credit_boost_bonuses', {
          p_source_ids: sourceIds,
          p_profile_ids: profileIds,
        });
        if (!error) {
          creditBoostBonusRows = data || [];
          const bySource = new Map<string, number>();
          const byProfile = new Map<string, number>();
          for (const row of creditBoostBonusRows) {
            const key = String(row.source_id || '');
            if (row.source_type === 'profile') byProfile.set(key, Number(row.bonus || 0));
            else bySource.set(key, Number(row.bonus || 0));
          }
          const annotate = (item: any) => {
            if (!item?.data) return item;
            const sourceId = String(item.data.id || '');
            const profileId = String(item.data.author_id || item.data.user_id || item.data.owner_id || '');
            const bonus = (bySource.get(sourceId) || 0) + (byProfile.get(profileId) || 0);
            return bonus > 0 ? { ...item, data: { ...item.data, credit_boost_bonus: bonus } } : item;
          };
          for (let i = 0; i < followed.length; i += 1) followed[i] = annotate(followed[i]);
          for (let i = 0; i < discovery.length; i += 1) discovery[i] = annotate(discovery[i]);
        } else {
          console.warn('[home-feed] credit boost ranking degraded', error);
        }
      }
    }

    const items = injectFollowing(discovery, followed, limit);
    const fedCandidateCount = fed.length;
    const followedFederatedCandidateCount = fed.filter((item: any) => item.source === 'following-federated').length;
    const discoveryFederatedCandidateCount = fedCandidateCount - followedFederatedCandidateCount;
    const renderedFederatedCount = items.filter((item: any) => item.type === 'fedpost').length;
    const federationLatencyMs = Number(fedResult?._meta?.latencyMs ?? (includeFederated ? Date.now() - federationStarted : 0));
    // Advance each local cursor to the oldest row across every source that
    // participates in that lane. Using only the generic posts query's oldest
    // row can skip or repeat followed, hashtag, community, and recommendation
    // posts because those sources have independent candidate sets.
    const oldestTimestamp = (rows: any[]) => rows
      .map((row) => String(row?.created_at || ''))
      .filter((value) => value && Number.isFinite(Date.parse(value)))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    const lastPost = oldestTimestamp([
      ...(postsResult.data || []),
      ...(followingPostsResult.data || []),
      ...(recommendedResult.data || []),
      ...(communityPostsResult.data || []),
      ...followedHashtagPosts,
    ]);
    const lastThread = oldestTimestamp([
      ...(threadsResult.data || []),
      ...(followingThreadsResult.data || []),
    ]);
    const nextFed = fedResult?.pagination?.nextCursor ?? null;
    const hasLocalMore =
      (postsResult.data || []).length >= sourceLimit ||
      (followingPostsResult.data || []).length >= sourceLimit ||
      (recommendedResult.data || []).length >= sourceLimit ||
      (communityPostsResult.data || []).length >= sourceLimit ||
      followedHashtagPosts.length >= sourceLimit ||
      (threadsResult.data || []).length >= sourceLimit ||
      (followingThreadsResult.data || []).length >= sourceLimit;
    const hasMore = hasLocalMore || Boolean(fedResult?.pagination?.hasMore);

    const nextCursor = hasMore && (lastPost || lastThread || nextFed)
      ? btoa(JSON.stringify({ post: lastPost, thread: lastThread, fed: nextFed }))
      : null;

    return json({
      ok: true,
      items,
      hasMore,
      nextCursor,
      latencyMs: Date.now() - started,
      algorithm: 'follow-affinity-recommendation-v6-federation-first-class',
      instrumentation: {
        federatedCandidatesFetched: fedCandidateCount,
        followedFederatedCandidates: followedFederatedCandidateCount,
        discoveryFederatedCandidates: discoveryFederatedCandidateCount,
        federatedCandidatesRendered: renderedFederatedCount,
        federationQueryLatencyMs: federationLatencyMs,
        federationError: fedResult?._meta?.error ?? null,
        activeCreditBoostBonusesApplied: creditBoostBonusRows.length,
      },
    }, 200, request);
  } catch (error) {
    console.error('[home-feed]', error);
    return json({ error: 'Home feed aggregation temporarily unavailable' }, 502, request);
  }
}
