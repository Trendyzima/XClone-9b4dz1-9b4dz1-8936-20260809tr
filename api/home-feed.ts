import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': 'https://testagram.site',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Vary': 'Authorization',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...CORS,
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
  const ageHours = Math.max(0, (Date.now() - new Date(d.created_at || 0).getTime()) / 3600000);
  const engagement = Math.log1p(Math.max(0, Number(d.likes_count ?? 0))) * 1.8
    + Math.log1p(Math.max(0, Number(d.replies_count ?? 0))) * 1.4
    + Math.log1p(Math.max(0, Number(d.reposts_count ?? 0))) * 2.2
    + Math.log1p(Math.max(0, Number(d.views_count ?? 0))) * 0.2;
  const freshness = Math.exp(-ageHours / 36) * 12;
  const sourceBoost = ['following-local','following-thread','following-federated'].includes(item.source) ? 40
    : item.source === 'recommendation' ? 24 : item.source === 'thread' ? 4 : 0;
  return sourceBoost + freshness + engagement + Number(d.recommendation_score ?? 0) * 5;
}

function blend(items: any[], limit: number) {
  const ranked = items.filter((x) => x?.data?.created_at).sort((a, b) =>
    candidateScore(b) - candidateScore(a) ||
    new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());
  const used = new Set<string>(), out: any[] = [];
  let lastSource = '';
  for (const item of ranked) {
    if (out.length >= limit) break;
    const key = sourceKey(item);
    if (used.has(key)) continue;
    if (item.source === lastSource && ranked.some((x) => x.source !== lastSource && !used.has(sourceKey(x))) && out.length % 3 !== 2) continue;
    used.add(key);
    out.push({ type: item.type, data: item.data });
    lastSource = item.source;
  }
  return out;
}

function injectFollowing(discovery: any[], following: any[], limit: number) {
  const seen = new Set<string>(), out: any[] = [];
  const reserve = Math.min(following.length, Math.max(1, Math.ceil(limit * 0.5)));
  for (const item of [...following].sort((a, b) => candidateScore(b) - candidateScore(a))) {
    if (out.length >= reserve) break;
    const key = sourceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: item.type, data: item.data });
  }
  for (const item of blend(discovery, limit)) {
    if (out.length >= limit) break;
    const key = sourceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export default async function handler(request: RequestLike) {
  const method = typeof (request as Request).method === 'string' ? (request as Request).method : '';
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (method !== 'GET') return json({ error: 'GET required' }, 405);
  const started = Date.now();

  try {
    const auth = await authenticate(request);
    if (!auth || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Authentication required' }, 401);

    const url = new URL(requestUrl(request));
    const limit = Math.max(4, Math.min(8, Math.floor(Number(url.searchParams.get('limit') || 6))));
    const before = url.searchParams.get('before');
    let cursor: { post?: string; thread?: string; fed?: string | null } = {};
    if (before) {
      try {
        const decoded = JSON.parse(atob(before));
        if (decoded && typeof decoded === 'object') cursor = decoded;
      } catch {
        return json({ error: 'Invalid feed cursor' }, 400);
      }
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    // Following is a first-class feed lane. A successful local or federated follow
    // must immediately influence what the user sees; it must not wait for a
    // recommendation batch or a model refresh.
    const { data: localFollowRows, error: localFollowError } = await admin
      .from('follows')
      .select('following_id,status')
      .eq('follower_id', auth.id);
    if (localFollowError) console.warn('[home-feed] local follows', localFollowError);
    const followedLocalIds = [...new Set((localFollowRows || [])
      .filter((row: any) => !row.status || ['accepted','active','following'].includes(String(row.status).toLowerCase()))
      .map((row: any) => String(row.following_id || ''))
      .filter(Boolean))];

    const sourceLimit = Math.max(6, Math.ceil(limit * 2));
    const recommendationQuery = admin.from('content_recommendations')
      .select('recommended_post_id,score,reason,source')
      .eq('user_id', auth.id).eq('shown', false)
      .order('score', { ascending: false }).limit(sourceLimit);

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

    if (cursor.post) { postsQuery.lt('created_at', cursor.post); followingPostsQuery?.lt('created_at', cursor.post); }
    if (cursor.thread) { threadsQuery.lt('created_at', cursor.thread); followingThreadsQuery?.lt('created_at', cursor.thread); }

    const includeFederated = url.searchParams.get('includeFederated') !== '0';
    const fedQuery = new URLSearchParams({ limit: String(sourceLimit) });
    if (cursor.fed) fedQuery.set('before', cursor.fed);

    const federatedPromise = includeFederated
      ? (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          try {
            const response = await fetch(SUPABASE_URL + '/functions/v1/federated-feed?' + fedQuery, {
              headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + auth.token },
              signal: controller.signal,
            });
            if (!response.ok) return { items: [], pagination: { hasMore: false, nextCursor: null } };
            return await response.json();
          } catch (error) {
            console.warn('[home-feed] federated source degraded', error);
            return { items: [], pagination: { hasMore: false, nextCursor: null } };
          } finally {
            clearTimeout(timer);
          }
        })()
      : Promise.resolve({ items: [], pagination: { hasMore: false, nextCursor: null } });

    const [recommendationResult, postsResult, followingPostsResult, threadsResult, followingThreadsResult, fedResult] = await Promise.all([
      recommendationQuery,
      postsQuery,
      followingPostsQuery || Promise.resolve({ data: [], error: null }),
      threadsQuery,
      followingThreadsQuery || Promise.resolve({ data: [], error: null }),
      federatedPromise,
    ]);
    // Organic discovery is intentionally outside the critical Home feed path.
    // Home renders the first local/following/federated page immediately; the reusable
    // discovery component loads one candidate after the shell has painted.

    if (postsResult.error) console.error('[home-feed] posts', postsResult.error);
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
    const recommendationById = new Map<string, RecommendationRow>(
      recommendationRows.map((r): [string, RecommendationRow] => [String(r.recommended_post_id), r])
    );
    const recommendations = (recommendedResult.data || []).map((p: any) => {
      const r = recommendationById.get(String(p.id));
      return { type: 'post', source: 'recommendation', data: { ...p, is_federated: false,
        feed_reason: r?.reason || 'Recommended for you', recommendation_score: Number(r?.score || 0) } };
    });

    const followingLocal = (followingPostsResult.data || []).map((p: any) => ({
      type: 'post', source: 'following-local',
      data: { ...p, is_federated: false, feed_reason: 'From someone you follow' },
    }));
    const local = (postsResult.data || [])
      .filter((p: any) => !followedLocalIds.includes(String(p.author_id || p.user_id || '')))
      .map((p: any) => ({ type: 'post', source: 'local', data: { ...p, is_federated: false } }));
    const followingThreads = (followingThreadsResult.data || []).map((t: any) => ({
      type: 'thread', source: 'following-thread',
      data: { ...t, is_federated: false, feed_reason: 'From someone you follow' },
    }));
    const threads = (threadsResult.data || [])
      .filter((t: any) => !followedLocalIds.includes(String(t.owner_id || '')))
      .map((t: any) => ({ type: 'thread', source: 'thread', data: { ...t, is_federated: false } }));
    const fedItems = Array.isArray(fedResult?.items) ? fedResult.items : [];

    const fed = fedItems.map((p: any) => ({
      type: 'fedpost', source: p.feed_source === 'following_actor' || p.feed_source === 'following_hashtag' ? 'following-federated' : 'federated',
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
      },
    }));

    const followed = [...followingLocal, ...followingThreads, ...fed.filter((item: any) => item.source === 'following-federated')];
    const discovery = [...recommendations, ...local, ...threads, ...fed.filter((item: any) => item.source !== 'following-federated')];
    const items = injectFollowing(discovery, followed, limit);
    const lastPost = postsResult.data?.at(-1)?.created_at;
    const lastThread = threadsResult.data?.at(-1)?.created_at;
    const nextFed = fedResult?.pagination?.nextCursor ?? null;
    const hasLocalMore = (postsResult.data || []).length >= sourceLimit || (threadsResult.data || []).length >= sourceLimit;
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
      algorithm: 'follow-affinity-recommendation-v5-cross-surface',
    });
  } catch (error) {
    console.error('[home-feed]', error);
    return json({ error: 'Home feed aggregation temporarily unavailable' }, 502);
  }
}
