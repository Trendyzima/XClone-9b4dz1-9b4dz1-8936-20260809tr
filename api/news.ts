import type { IncomingMessage, ServerResponse } from 'node:http';

const SUPABASE_ORIGIN = 'https://ffrhglgkukgsuhxenena.supabase.co';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || '/api/news', 'https://testagram.site');
    const requested = Number(url.searchParams.get('limit') || '20');
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 1), 50);
    const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '');
    if (!key) return json(res, 503, { ok: false, error: 'SUPABASE_PUBLIC_KEY_NOT_CONFIGURED' });

    const endpoint = new URL('/rest/v1/news_items', SUPABASE_ORIGIN);
    endpoint.searchParams.set('select', 'id,title,content,excerpt,trend_id,trend_title,geo,language,source_url,newsify_url,detail_url,importance_score,importance_tier,published_at,created_at,updated_at');
    endpoint.searchParams.set('order', 'created_at.desc');
    endpoint.searchParams.set('limit', String(limit));

    const response = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' });
    const body = await response.text();
    if (!response.ok) return json(res, 502, { ok: false, error: 'NEWS_STORE_UNAVAILABLE' });
    return json(res, 200, { ok: true, source: 'newsify', items: JSON.parse(body) });
  } catch (error) {
    console.error('[Testagram] news API failed', error);
    return json(res, 500, { ok: false, error: 'NEWS_API_FAILED' });
  }
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=300');
  res.end(JSON.stringify(payload));
}
