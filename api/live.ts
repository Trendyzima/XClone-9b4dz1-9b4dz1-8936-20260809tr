export const config = { runtime: 'edge' };

const allowedActions = new Set([
  'start', 'viewer', 'verify', 'stop', 'create-guest', 'guest',
  'guest-control-list', 'guest-control', 'heartbeat', 'youtube-encoder-config',
]);

const env = (name: string) => {
  const root = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
  return root.process?.env?.[name]?.trim() ?? '';
};

const json = (body: unknown, status = 200, origin?: string) => {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-request-id, x-testagram-api-version',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(JSON.stringify(body), { status, headers });
};

function backendOrigin(request: Request): URL | null {
  const configured = env('TESTAGRAM_BACKEND_API_URL') || env('TESTAGRAM_API_URL');
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const localHTTP = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHTTP) || url.username || url.password ||
        (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function requestId(request: Request): string {
  const supplied = request.headers.get('X-Request-ID')?.trim() ?? '';
  return supplied && supplied.length <= 128 && !/[\\r\\n]/.test(supplied)
    ? supplied
    : globalThis.crypto.randomUUID();
}

export default async function handler(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const requestOrigin = new URL(request.url).origin;
  const configuredOrigins = (env('TESTAGRAM_ALLOWED_ORIGINS') || 'https://testagram.site,https://www.testagram.site')
    .split(',').map(value => value.trim()).filter(Boolean);
  const originAllowed = !origin || origin === requestOrigin || configuredOrigins.includes(origin);
  if (!originAllowed) return json({ ok: false, error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' } }, 403);

  if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin || requestOrigin);
  const isGet = request.method === 'GET';
  if (!isGet && request.method !== 'POST') {
    return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST required.' } }, 405, origin || requestOrigin);
  }

  const backend = backendOrigin(request);
  if (!backend) {
    return json({ ok: false, error: { code: 'BACKEND_API_NOT_CONFIGURED', message: 'Testagram Backend API origin is not configured.' } }, 503, origin || requestOrigin);
  }

  let input: Record<string, unknown>;
  if (isGet) {
    const params = new URL(request.url).searchParams;
    input = { action: params.get('action') || '', stream_id: params.get('stream_id') || '' };
  } else {
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid object');
      input = parsed as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: { code: 'INVALID_JSON', message: 'One JSON object is required.' } }, 400, origin || requestOrigin);
    }
  }

  const action = typeof input.action === 'string' ? input.action : '';
  const streamId = typeof input.stream_id === 'string' ? input.stream_id.trim() : '';
  if (!allowedActions.has(action)) {
    return json({ ok: false, error: { code: 'ACTION_INVALID', message: 'Unsupported TV action.' } }, 400, origin || requestOrigin);
  }
  if (isGet && action !== 'viewer') {
    return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET is only supported for public viewer lookup.' } }, 405, origin || requestOrigin);
  }
  if (!streamId || streamId.length > 128 || /[\\r\\n]/.test(streamId)) {
    return json({ ok: false, error: { code: 'STREAM_ID_INVALID', message: 'A valid stream_id is required.' } }, 400, origin || requestOrigin);
  }

  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  const isPublicViewer = isGet && action === 'viewer';
  if (!isPublicViewer && !/^Bearer [^\\s]{8,8192}$/.test(authorization)) {
    return json({ ok: false, error: { code: 'APPWRITE_SESSION_REQUIRED', message: 'A valid Appwrite session is required.' } }, 401, origin || requestOrigin);
  }

  const id = requestId(request);
  const target = new URL('/v1/tv/control', backend);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Testagram-API-Version': '1',
        'X-Request-ID': id,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({
        action,
        stream_id: streamId,
        provider: typeof input.provider === 'string' ? input.provider : undefined,
        invite_token: typeof input.invite_token === 'string' ? input.invite_token : undefined,
        encoder_token: typeof input.encoder_token === 'string' ? input.encoder_token : undefined,
        diagnostics: input.diagnostics,
        guest_slot: input.guest_slot,
        control: typeof input.control === 'string' ? input.control : undefined,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      error: { code: 'BACKEND_INVALID_RESPONSE', message: 'Backend returned invalid JSON.' },
      request_id: id,
    }));
    return json(payload, response.status, origin || requestOrigin);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return json({
      ok: false,
      error: {
        code: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_UNREACHABLE',
        message: timedOut ? 'Testagram Backend TV control timed out.' : 'Testagram Backend TV control is unreachable.',
      },
      request_id: id,
    }, timedOut ? 504 : 502, origin || requestOrigin);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
