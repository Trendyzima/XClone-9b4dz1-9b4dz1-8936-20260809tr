import type { IncomingMessage, ServerResponse } from 'node:http';

const BASE_URL = 'https://sportscore.com/api/widget/';
const ALLOWED_SPORTS = new Set(['football', 'basketball', 'cricket', 'tennis']);
const ATTRIBUTION = { label: 'Powered by SportScore', url: 'https://sportscore.com/' };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  try {
    const requestUrl = new URL(req.url || '/api/sports', 'https://testagram.site');
    const sport = (requestUrl.searchParams.get('sport') || 'football').toLowerCase();
    const kind = (requestUrl.searchParams.get('kind') || 'matches').toLowerCase();
    if (!ALLOWED_SPORTS.has(sport)) return json(res, 400, { ok: false, error: 'UNSUPPORTED_SPORT' });

    const endpoint = kind === 'matches' ? 'matches/' : kind === 'standings' ? 'standings/' : kind === 'topscorers' ? 'topscorers/' : '';
    if (!endpoint) return json(res, 400, { ok: false, error: 'UNSUPPORTED_KIND' });

    const params = new URLSearchParams({ sport, src: 'testagram.site' });
    const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('limit') || '20') || 20));
    if (kind !== 'standings') params.set('limit', String(limit));
    const slug = (requestUrl.searchParams.get('slug') || '').trim();
    if (kind !== 'matches' && !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug)) {
      return json(res, 400, { ok: false, error: 'VALID_SLUG_REQUIRED' });
    }
    if (slug) params.set('slug', slug);
    const stat = requestUrl.searchParams.get('stat');
    if (kind === 'topscorers' && (stat === 'goals' || stat === 'assists')) params.set('stat', stat);

    const upstream = await fetch(BASE_URL + endpoint + '?' + params.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'Testagram Sports Hub/1.0 (+https://testagram.site)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      console.error('[sports] upstream rejected request', { status: upstream.status, sport, kind });
      return json(res, 502, { ok: false, error: 'SPORTS_PROVIDER_UNAVAILABLE', attribution: ATTRIBUTION });
    }
    const data: unknown = await upstream.json();
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.setHeader('X-Testagram-Sports-Provider', 'SportScore');
    return json(res, 200, { ok: true, sport, kind, attribution: ATTRIBUTION, data });
  } catch (error) {
    console.error('[sports] request failed', error);
    return json(res, 502, { ok: false, error: 'SPORTS_PROVIDER_UNAVAILABLE', attribution: ATTRIBUTION });
  }
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
