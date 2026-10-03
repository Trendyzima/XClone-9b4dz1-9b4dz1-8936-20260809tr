const SUPABASE_ORIGIN = 'https://ffrhglgkukgsuhxenena.supabase.co';

type Env = {
  ASSETS: Fetcher;
  [key: string]: unknown;
};

const EDGE_ROUTES: Record<string, string> = {
  '/api/capability': '../api/capability',
  '/api/health': '../api/health',
  '/api/ready': '../api/ready',
  '/api/home-discovery': '../api/home-discovery',
  '/api/home-feed': '../api/home-feed',
  '/api/live': '../api/live',
};

const NODE_ROUTES: Record<string, string> = {
  '/api/media': '../api/media',
  '/api/auth/send-sms': '../api/auth/send-sms',
  '/api/story-cleanup': '../api/story-cleanup',
};

function setRuntimeEnv(env: Env, commit?: string) {
  const current = (globalThis as any).process?.env ?? {};
  (globalThis as any).process = {
    ...(globalThis as any).process,
    env: {
      ...current,
      ...Object.fromEntries(Object.entries(env).filter(([key]) =>
        /^[A-Z0-9_]+$/.test(key) && typeof valueOf(env, key) === 'string'
      ).map(([key]) => [key, String(valueOf(env, key))])),
      TESTAGRAM_COMMIT_SHA: commit || current.TESTAGRAM_COMMIT_SHA || 'cloudflare',
    },
  };
}

function valueOf(env: Env, key: string) {
  return (env as any)[key];
}

function commonHeaders(headers = new Headers()) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  return headers;
}

async function invokeEdge(pathname: string, request: Request, env: Env) {
  const modulePath = EDGE_ROUTES[pathname];
  if (!modulePath) return null;
  setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);
  const mod = await import(modulePath);
  return mod.default(request);
}

async function invokeNode(pathname: string, request: Request, env: Env) {
  const modulePath = NODE_ROUTES[pathname];
  if (!modulePath) return null;
  setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);

  const mod = await import(modulePath);
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();

  const req: any = {
    method: request.method,
    url: new URL(request.url).pathname + new URL(request.url).search,
    headers: Object.fromEntries(request.headers.entries()),
    body: body ?? undefined,
  };

  let status = 200;
  const responseHeaders = new Headers();

  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      responseHeaders.set(name, String(value));
      return this;
    },
    getHeader(name: string) {
      return responseHeaders.get(name);
    },
    json(payload: unknown) {
      responseHeaders.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(payload), {
        status,
        headers: commonHeaders(responseHeaders),
      });
    },
    send(payload: unknown) {
      return new Response(payload == null ? null : String(payload), {
        status,
        headers: commonHeaders(responseHeaders),
      });
    },
    end(payload?: unknown) {
      return new Response(payload == null ? null : String(payload), {
        status,
        headers: commonHeaders(responseHeaders),
      });
    },
  };

  const result = await mod.default(req, res);
  if (result instanceof Response) return result;
  return new Response(null, { status, headers: commonHeaders(responseHeaders) });
}

function supabaseRewrite(pathname: string) {
  if (pathname === '/.well-known/webfinger') return '/functions/v1/mastodon-edge/.well-known/webfinger';
  if (pathname === '/.well-known/nodeinfo') return '/functions/v1/mastodon-federation/.well-known/nodeinfo';
  if (pathname === '/.well-known/oauth-authorization-server') return '/functions/v1/mastodon-api/.well-known/oauth-authorization-server';
  if (pathname === '/nodeinfo/2.0') return '/functions/v1/mastodon-federation/nodeinfo/2.0';
  if (pathname === '/inbox') return '/functions/v1/mastodon-edge/inbox';

  const user = pathname.match(/^\/users\/([^/]+)(\/.*)?$/);
  if (user) return `/functions/v1/mastodon-edge/users/${user[1]}${user[2] || ''}`;

  const api = pathname.match(/^\/api\/(v1|v2)\/(.*)$/);
  if (api) return `/functions/v1/mastodon-api/api/${api[1]}/${api[2]}`;

  const oauth = pathname.match(/^\/oauth\/(.*)$/);
  if (oauth) return `/functions/v1/mastodon-api/oauth/${oauth[1]}`;

  return null;
}

async function proxySupabase(request: Request, targetPath: string) {
  const target = new URL(targetPath + new URL(request.url).search, SUPABASE_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('host');

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });

  const out = new Headers(response.headers);
  out.delete('content-length');
  out.delete('transfer-encoding');
  return new Response(response.body, { status: response.status, headers: out });
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const edge = await invokeEdge(url.pathname, request, env);
  if (edge) return edge;

  const node = await invokeNode(url.pathname, request, env);
  if (node) return node;

  const rewrite = supabaseRewrite(url.pathname);
  if (rewrite) return proxySupabase(request, rewrite);

  return new Response(JSON.stringify({
    ok: false,
    error: 'API_ROUTE_NOT_MIGRATED',
    path: url.pathname,
  }), {
    status: 501,
    headers: commonHeaders(new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })),
  });
}

async function handleStoryCleanup(env: Env) {
  setRuntimeEnv(env, (env as any).TESTAGRAM_COMMIT_SHA);
  const mod = await import('../api/story-cleanup');
  let status = 200;
  const headers = new Headers();
  const res: any = {
    status(code: number) { status = code; return this; },
    setHeader(name: string, value: string) { headers.set(name, String(value)); return this; },
    json(payload: unknown) {
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(payload), { status, headers: commonHeaders(headers) });
    },
    end(payload?: unknown) {
      return new Response(payload == null ? null : String(payload), { status, headers: commonHeaders(headers) });
    },
  };
  const req: any = {
    method: 'POST',
    url: '/api/story-cleanup',
    headers: { authorization: `Bearer ${String((env as any).CRON_SECRET || '')}` },
    body: undefined,
  };
  const result = await mod.default(req, res);
  return result instanceof Response ? result : new Response(null, { status, headers });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env);
      }

      const rewrite = supabaseRewrite(url.pathname);
      if (rewrite) return await proxySupabase(request, rewrite);

      const response = await env.ASSETS.fetch(request);
      const headers = commonHeaders(new Headers(response.headers));

      if (url.pathname.startsWith('/assets/') || /\\.(js|css)$/.test(url.pathname)) {
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (/\\.(xml)$/.test(url.pathname)) {
        headers.set('Cache-Control', 'public, max-age=86400');
      } else {
        headers.set('Cache-Control', 'no-store');
      }

      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error('[testagram-worker]', error);
      return new Response(JSON.stringify({ ok: false, error: 'Internal hosting error' }), {
        status: 500,
        headers: commonHeaders(new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })),
      });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env) {
    try {
      await handleStoryCleanup(env);
    } catch (error) {
      console.error('[testagram-worker] scheduled cleanup failed', error);
    }
  },
} satisfies ExportedHandler<Env>;
