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
    'Access-Control-Allow-Headers': 'accept, x-request-id',
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

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => /^\d{1,3}$/.test(part) ? Number(part) : -1);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}

function trustedFederationHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === 'federation' || host.endsWith('.internal') ||
    host.endsWith('.local') || host === '::1' || isPrivateIPv4(host);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function federationOrigin(): string | null {
  const raw = (process.env.TESTAGRAM_FEDERATION_API_URL ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const privateHost = trustedFederationHost(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export default async function handler(request: Request): Promise<Response> {
  const incomingRequestId = request.headers.get('x-request-id') ?? '';
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(incomingRequestId)
    ? incomingRequestId
    : globalThis.crypto.randomUUID();

  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('origin') ?? '';
    if (!ALLOWED_ORIGINS.has(origin)) {
      return json(request, 403, { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED' }, request_id: requestId }, requestId);
    }
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'GET') {
    return json(request, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' }, request_id: requestId }, requestId);
  }
  const origin = request.headers.get('origin') ?? '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, 403, { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED' }, request_id: requestId }, requestId);
  }

  const incoming = new URL(request.url);
  const username = (incoming.searchParams.get('username') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_][a-z0-9_.-]{2,63}$/.test(username) || username === '.' || username === '..') {
    return json(request, 400, { ok: false, error: { code: 'INVALID_ACTOR_HANDLE' }, request_id: requestId }, requestId);
  }

  const federation = federationOrigin();
  if (!federation) {
    return json(request, 503, { ok: false, error: { code: 'FEDERATION_NOT_CONFIGURED' }, request_id: requestId }, requestId);
  }

  const target = new URL('/users/' + encodeURIComponent(username), federation);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        'X-Request-ID': requestId,
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return json(request, 502, { ok: false, error: { code: 'FEDERATION_REDIRECT_REJECTED' }, request_id: requestId }, requestId);
    }
    const bytes = await readBoundedBody(upstream, 256 * 1024);
    if (!bytes) {
      return json(request, 502, { ok: false, error: { code: 'ACTOR_RESPONSE_TOO_LARGE' }, request_id: requestId }, requestId);
    }
    const headers = corsHeaders(request);
    headers['Content-Type'] = upstream.headers.get('content-type') ?? 'application/activity+json; charset=utf-8';
    headers['X-Request-ID'] = upstream.headers.get('x-request-id') ?? requestId;
    headers['Cache-Control'] = upstream.headers.get('cache-control') ?? 'private, no-store';
    // Materialize an ArrayBuffer so TypeScript's DOM BodyInit type does not
    // retain Uint8Array<ArrayBufferLike> (which could include SharedArrayBuffer).
    const bodyBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(bodyBuffer).set(bytes);
    return new Response(bodyBuffer, { status: upstream.status, headers });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return json(request, timedOut ? 504 : 502, {
      ok: false,
      error: { code: timedOut ? 'FEDERATION_TIMEOUT' : 'FEDERATION_UNAVAILABLE' },
      request_id: requestId,
    }, requestId);
  } finally {
    clearTimeout(timeout);
  }
}
