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

type RequestLike = Request | {
  headers?: Headers | Record<string, string | string[] | undefined>;
  url?: string;
};

function getHeader(request: RequestLike, name: string): string {
  const headers = request.headers;
  if (!headers) return '';
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) || '';
  }
  const value = (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function getRequestUrl(request: RequestLike): string {
  if (typeof request.url === 'string' && request.url) return request.url;
  return 'https://testagram.site/api/home-feed';
}

async function authenticate(request: RequestLike): Promise<string | null> {
  const authorization = getHeader(request, 'authorization');
  if (!/^Bearer\s+/i.test(authorization) || !SUPABASE_ANON_KEY) return null;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

function parseCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value));
    if (
      typeof parsed?.score !== 'number' ||
      typeof parsed?.createdAt !== 'string' ||
      typeof parsed?.id !== 'string'
    ) return null;
    return parsed as { score: number; createdAt: string; id: string };
  } catch {
    return null;
  }
}

function encodeCursor(row: { score: number; created_at: string; post_id: string }) {
  return btoa(JSON.stringify({
    score: Number(row.score),
    createdAt: row.created_at,
    id: row.post_id,
  }));
}

export default async function handler(request: RequestLike) {
  const method = typeof (request as Request).method === 'string'
    ? (request as Request).method
    : '';
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (method !== 'GET') return json({ error: 'GET required' }, 405);

  const started = Date.now();
  try {
    const userId = await authenticate(request);
    if (!userId || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Authentication required' }, 401);

    const url = new URL(getRequestUrl(request));
    const rawLimit = Number(url.searchParams.get('limit') || 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20));
    const cursor = parseCursor(url.searchParams.get('cursor'));

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rankedRows, error: rankError } = await admin.rpc('get_ranked_home_feed', {
      p_user_id: userId,
      p_cursor_score: cursor?.score ?? null,
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limit: limit,
    });

    if (rankError) {
      console.error('[home-feed] ranking RPC failed', rankError);
      return json({ error: 'Feed ranking unavailable' }, 503);
    }

    const rows = Array.isArray(rankedRows) ? rankedRows : [];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const ids = pageRows.map((row: any) => row.post_id).filter(Boolean);

    if (!ids.length) {
      return json({
        ok: true,
        items: [],
        nextCursor: null,
        hasMore: false,
        latencyMs: Date.now() - started,
        algorithm: 'server-ranked-v1',
      });
    }

    const { data: posts, error: postsError } = await admin
      .from('posts')
      .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
      .in('id', ids)
      .is('community_id', null);

    if (postsError) {
      console.error('[home-feed] post hydration failed', postsError);
      return json({ error: 'Feed hydration unavailable' }, 503);
    }

    const postById = new Map<string, any>((posts || []).map((post: any) => [String(post.id), post]));
    const items = pageRows
      .map((row: any) => {
        const post = postById.get(String(row.post_id));
        if (!post) return null;
        return {
          type: 'post',
          data: {
            ...post,
            _feed_score: Number(row.score),
            _feed_reason: row.reason,
            _feed_source: row.source,
          },
        };
      })
      .filter(Boolean);

    const last = pageRows[pageRows.length - 1];
    return json({
      ok: true,
      items,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      hasMore,
      latencyMs: Date.now() - started,
      algorithm: 'server-ranked-v1',
    });
  } catch (error) {
    console.error('[home-feed]', error);
    return json({ error: error instanceof Error ? error.message : 'Feed failed' }, 500);
  }
}
