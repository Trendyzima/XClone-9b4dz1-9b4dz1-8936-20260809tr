export const config = { runtime: 'edge' };

const ALLOWED_ORIGINS = new Set([
  'https://testagram.site',
  'https://www.testagram.site',
]);

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, accept, x-request-id',
    'Cache-Control': 'private, no-store',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(request: Request, status: number, body: unknown, requestId = ''): Response {
  const headers = corsHeaders(request);
  headers['Content-Type'] = 'application/json; charset=utf-8';
  if (requestId) headers['X-Request-ID'] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function backendOrigin(): string | null {
  const raw = (process.env.TESTAGRAM_BACKEND_API_URL ?? process.env.TESTAGRAM_FRESH_API_URL ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export default async function handler(request: Request): Promise<Response> {
  const requestIdHeader = request.headers.get('x-request-id') ?? '';
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(requestIdHeader)
    ? requestIdHeader
    : globalThis.crypto.randomUUID();

  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('origin') ?? '';
    if (!ALLOWED_ORIGINS.has(origin)) return json(request, 403, { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED' }, request_id: requestId }, requestId);
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'GET') {
    return json(request, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' }, request_id: requestId }, requestId);
  }
  const origin = request.headers.get('origin') ?? '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, 403, { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED' }, request_id: requestId }, requestId);
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S{16,8192}$/i.test(authorization)) {
    return json(request, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'A valid Appwrite session token is required.' }, request_id: requestId }, requestId);
  }

  const backend = backendOrigin();
  if (!backend) {
    return json(request, 503, { ok: false, error: { code: 'BACKEND_NOT_CONFIGURED', message: 'The centralized Testagram Backend API is not configured.' }, request_id: requestId }, requestId);
  }

  const incoming = new URL(request.url);
  const limitRaw = incoming.searchParams.get('limit') ?? '20';
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return json(request, 400, { ok: false, error: { code: 'INVALID_LIMIT', message: 'Feed limit must be between 1 and 50.' }, request_id: requestId }, requestId);
  }
  const before = incoming.searchParams.get('before') ?? '';
  if (before.length > 1024 || /[\r\n]/.test(before)) {
    return json(request, 400, { ok: false, error: { code: 'INVALID_CURSOR', message: 'Feed cursor is invalid.' }, request_id: requestId }, requestId);
  }

  const target = new URL('/v1/feed/home', backend);
  target.searchParams.set('limit', String(limit));
  if (before) target.searchParams.set('before', before);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        'X-Testagram-API-Version': '1',
        'X-Request-ID': requestId,
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > 2 * 1024 * 1024) {
      return json(request, 502, { ok: false, error: { code: 'BACKEND_RESPONSE_TOO_LARGE' }, request_id: requestId }, requestId);
    }
    const headers = corsHeaders(request);
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['X-Request-ID'] = upstream.headers.get('x-request-id') ?? requestId;
    return new Response(bytes, { status: upstream.status, headers });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return json(request, timedOut ? 504 : 502, {
      ok: false,
      error: {
        code: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_UNAVAILABLE',
        message: timedOut ? 'The Testagram Backend timed out.' : 'The Testagram Backend could not be reached.',
      },
      request_id: requestId,
    }, requestId);
  } finally {
    clearTimeout(timeout);
  }
}
