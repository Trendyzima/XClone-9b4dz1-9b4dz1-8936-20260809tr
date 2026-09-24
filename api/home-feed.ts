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

function blend(items: any[], limit: number) {
  const sorted = items.filter((x) => x?.data?.created_at).sort((a, b) =>
    new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime()
  );
  const freshCut = Math.max(1, Math.ceil(sorted.length * 0.5));
  const fresh = sorted.slice(0, freshCut);
  const older = sorted.slice(freshCut);
  const used = new Set<string>();
  const out: any[] = [];
  let fi = 0, oi = 0, lastSource = '';

  while (out.length < limit && (fi < fresh.length || oi < older.length)) {
    const preferOld = out.length > 0 && out.length % 3 !== 0 && oi < older.length;
    const pool = preferOld ? older : fresh;
    const start = preferOld ? oi : fi;
    let candidate: any = null;
    let candidateIndex = -1;

    for (let i = start; i < pool.length; i++) {
      const item = pool[i];
      const key = sourceKey(item);
      if (used.has(key)) continue;
      if (item.source !== lastSource || !pool.some((x) => x.source !== lastSource && !used.has(sourceKey(x)))) {
        candidate = item;
        candidateIndex = i;
        break;
      }
    }
    if (!candidate) {
      const fallback = pool.find((x) => !used.has(sourceKey(x)));
      if (fallback) { candidate = fallback; candidateIndex = pool.indexOf(fallback); }
    }
    if (!candidate) {
      if (preferOld) oi = older.length;
      else fi = fresh.length;
      continue;
    }

    used.add(sourceKey(candidate));
    out.push({ type: candidate.type, data: candidate.data });
    lastSource = candidate.source;
    if (preferOld) oi = candidateIndex + 1;
    else fi = candidateIndex + 1;
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
    const sourceLimit = Math.max(4, Math.ceil(limit / 2));
    const postsQuery = admin.from('posts')
      .select('*, user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
      .is('community_id', null).is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(sourceLimit);
    const threadsQuery = admin.from('threads')
      .select('*')
      .eq('visibility', 'public').is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(sourceLimit);

    if (cursor.post) postsQuery.lt('created_at', cursor.post);
    if (cursor.thread) threadsQuery.lt('created_at', cursor.thread);

    const fedQuery = new URLSearchParams({ limit: String(sourceLimit) });
    if (cursor.fed) fedQuery.set('before', cursor.fed);

    const discoveryQuery = new URLSearchParams({ limit: '1', surface: 'home' });
  const [postsResult, threadsResult, fedResponse, discoveryResponse] = await Promise.all([
      postsQuery,
      threadsQuery,
      fetch(SUPABASE_URL + '/functions/v1/federated-feed?' + fedQuery, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + auth.token },
      }),
    ]);

    const fedResult = fedResponse.ok
      ? await fedResponse.json()
      : { items: [], pagination: { hasMore: false, nextCursor: null } };
    const discoveryResult = discoveryResponse.ok
      ? await discoveryResponse.json()
      : { items: [] };

    if (postsResult.error) console.error('[home-feed] posts', postsResult.error);
    if (threadsResult.error) console.error('[home-feed] threads', threadsResult.error);

    const local = (postsResult.data || []).map((p: any) => ({
      type: 'post', source: 'local',
      data: { ...p, is_federated: false },
    }));
    const threads = (threadsResult.data || []).map((t: any) => ({
      type: 'thread', source: 'thread',
      data: { ...t, is_federated: false },
    }));
    const fedItems = Array.isArray(fedResult?.items) ? fedResult.items : [];
    const discoveryItems = Array.isArray(discoveryResult?.items) ? discoveryResult.items : [];
    const discovery = discoveryItems.map((p: any) => ({
      type: 'fedpost', source: 'federated-discovery',
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
    const fed = fedItems.map((p: any) => ({
      type: 'fedpost', source: 'federated',
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

    const items = blend([...local, ...threads, ...fed, ...discovery], limit);
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
      algorithm: 'organic-cross-surface-v4-cursor-federated-discovery',
    });
  } catch (error) {
    console.error('[home-feed]', error);
    return json({ error: 'Home feed aggregation temporarily unavailable' }, 502);
  }
}
