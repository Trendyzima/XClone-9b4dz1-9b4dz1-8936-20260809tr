export const config = { runtime: 'edge' };

const CANONICAL_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const CANONICAL_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';
const DEPENDENCY_TIMEOUT_MS = 4500;

function result(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Race the deadline against fetch as well as aborting it. Some edge/network
// adapters do not settle promptly after AbortController.abort(); the deadline
// must still bound the externally visible readiness response.
async function boundedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        controller.abort();
        const error = new Error('Readiness dependency exceeded its deadline');
        error.name = 'AbortError';
        reject(error);
      }, timeoutMs);
    });
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

function validOwnedApiOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.hostname.toLowerCase().endsWith('.supabase.co')) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export default async function handler(_request: Request) {
  // In self-hosted mode readiness follows the owned API and its PostgreSQL
  // dependency. Do not report hosted Supabase readiness or silently fall back.
  if (process.env.TESTAGRAM_SELF_HOSTED === 'true') {
    const configured = process.env.TESTAGRAM_API_URL?.trim();
    const apiOrigin = configured ? validOwnedApiOrigin(configured) : null;
    if (!apiOrigin) {
      return result(503, {
        ok: false,
        database: 'unconfigured',
        dependency: 'self-hosted-api',
        error: 'TESTAGRAM_API_URL must be a verified owned HTTPS origin',
      });
    }
    try {
      const response = await boundedFetch(apiOrigin + '/readyz', {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }, DEPENDENCY_TIMEOUT_MS);
      let body: Record<string, unknown> = {};
      try { body = await response.json() as Record<string, unknown>; } catch {}
      const healthy = response.ok && body.ok !== false;
      return result(healthy ? 200 : 503, {
        ok: healthy,
        database: healthy ? 'reachable' : 'unhealthy',
        dependency: 'self-hosted-postgres',
        upstream_status: response.status,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return result(503, {
        ok: false,
        database: timedOut ? 'timeout' : 'unreachable',
        dependency: 'self-hosted-api',
      });
    }
  }

  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    CANONICAL_SUPABASE_URL
  ).replace(/\/$/, '');
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    CANONICAL_PUBLISHABLE_KEY;

  try {
    // limit=0 avoids returning user data while still exercising PostgREST and
    // the database relation used by the application.
    const response = await boundedFetch(
      supabaseUrl + '/rest/v1/profiles?select=id&limit=0',
      {
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
      DEPENDENCY_TIMEOUT_MS,
    );
    const healthy = response.ok;
    return result(healthy ? 200 : 503, {
      ok: healthy,
      database: healthy ? 'reachable' : 'unhealthy',
      dependency: 'postgrest',
      upstream_status: response.status,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return result(503, {
      ok: false,
      database: timedOut ? 'timeout' : 'unreachable',
      dependency: 'postgrest',
    });
  }
}
