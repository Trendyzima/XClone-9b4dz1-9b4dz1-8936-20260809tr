export const config = { runtime: 'edge' };

const ALLOWED_ORIGINS = new Set(['https://testagram.site', 'https://www.testagram.site']);

export default async function handler(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://testagram.site';
  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, accept, x-request-id',
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }), { status: 405, headers });
  }
  return new Response(JSON.stringify({
    ok: false,
    error: {
      code: 'LEGACY_FEED_RETIRED',
      message: 'The legacy feed endpoint has been retired. Use the authenticated Testagram Backend feed API.',
    },
  }), { status: 410, headers });
}
