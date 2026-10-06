interface Env {
  MEDIA_BUCKET: R2Bucket;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

async function redisCommand(env: Env, command: unknown[]): Promise<unknown> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    const response = await fetch(env.UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.UPSTASH_REDIS_REST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!response.ok) return null;
    return (await response.json() as { result?: unknown }).result ?? null;
  } catch { return null; }
}

async function redisGet(env: Env, key: string): Promise<string | null> {
  const result = await redisCommand(env, ['GET', key]);
  return typeof result === 'string' ? result : null;
}

async function recordProbe(env: Env, summary: Record<string, unknown>): Promise<void> {
  await redisCommand(env, ['SET', 'observability:cdn:v1:latest', JSON.stringify(summary), 'EX', '900']);
}

function keyFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/media/')) return null;
  let key = '';
  try { key = decodeURIComponent(pathname.slice('/media/'.length)); } catch { return null; }
  if (!key || key.length > 512) return null;
  if (!key.startsWith('users/') && !key.startsWith('profiles/')) return null;
  return key;
}

async function healthResponse(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true, service: 'testagram-cdn', edge: 'reachable' }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function scheduledProbe(env: Env): Promise<void> {
  const origin = 'https://testagram.site';
  const checks = [
    { name: 'production-liveness', url: origin + '/api/health' },
    { name: 'production-readiness', url: origin + '/api/ready' },
    { name: 'cdn-self-health', url: 'https://cdn.testagram.site/health' },
  ];
  const results = await Promise.all(checks.map(async (check) => {
    const started = Date.now();
    try {
      const response = await fetch(check.url, { headers: { accept: 'application/json', 'user-agent': 'testagram-cdn-observer/1.0' } });
      const body = await response.text();
      const ok = response.status === 200;
      return { name: check.name, ok, status: response.status, latency_ms: Date.now() - started, body: body.slice(0, 300) };
    } catch (error) {
      return { name: check.name, ok: false, status: 'network_error', latency_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const summary = { checked_at: new Date().toISOString(), ok: results.every(result => result.ok), results };
  await recordProbe(env, summary);
  if (!summary.ok) console.error(JSON.stringify({ event: 'testagram_observability_failure', ...summary }));
  else console.log(JSON.stringify({ event: 'testagram_observability_ok', ...summary }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    if (url.pathname === '/health') return request.method === 'HEAD' ? new Response(null, { status: 200 }) : healthResponse();

    const key = keyFromPath(url.pathname);
    if (!key) return new Response('Not found', { status: 404 });

    const cachedRoute = await redisGet(env, 'media:route:v1:' + key);
    let objectKey = key;
    if (cachedRoute) {
      try {
        const route = JSON.parse(cachedRoute) as { storage_key?: string };
        if (route.storage_key === key) objectKey = route.storage_key;
      } catch {}
    }

    const object = await env.MEDIA_BUCKET.get(objectKey, {
      range: request.headers,
      onlyIf: request.headers.has('if-none-match') ? { etagMatches: request.headers.get('if-none-match')! } : undefined,
    });
    if (!object) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    headers.set('x-testagram-cdn', 'cloudflare');
    headers.set('x-testagram-cdn-version', '2026-10-06-health-v3');
    headers.set('x-testagram-cache-plane', cachedRoute ? 'upstash-hit' : 'upstash-miss');
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await scheduledProbe(env);
  },
} satisfies ExportedHandler<Env>;