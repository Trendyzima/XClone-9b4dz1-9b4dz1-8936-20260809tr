export const config = { runtime: 'edge' };

const CANONICAL_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const CANONICAL_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';
const DEPENDENCY_TIMEOUT_MS = 4500;
const MAX_READINESS_BODY_BYTES = 16 * 1024;

function result(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

type BoundedResponse = { response: Response; body: string };

// The deadline covers connection, headers, AND body consumption. A fetch can
// resolve at headers and then hang forever while response.text()/json() reads
// a stalled stream, so racing only fetch() is not a complete hard deadline.
async function boundedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<BoundedResponse> {
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      controller.abort();
      const error = new Error('Readiness dependency exceeded its deadline');
      error.name = 'AbortError';
      reject(error);
    }, timeoutMs);
  });

  try {
    const operation = (async (): Promise<BoundedResponse> => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_READINESS_BODY_BYTES) {
        await response.body?.cancel();
        throw new Error('Readiness response body exceeded size limit');
      }

      if (!response.body) return { response, body: '' };
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_READINESS_BODY_BYTES) {
            await reader.cancel();
            throw new Error('Readiness response body exceeded size limit');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { response, body: new TextDecoder().decode(merged) };
    })();

    return await Promise.race([operation, deadline]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    controller.abort();
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
  // In self-hosted mode readiness follows the owned Go API and its PostgreSQL
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
      const { response, body } = await boundedFetch(apiOrigin + '/readyz', {
        method: 'GET',
        headers: { accept: 'text/plain' },
        cache: 'no-store',
      }, DEPENDENCY_TIMEOUT_MS);
      // Testagram Go /readyz returns plain-text "ready" on success, not JSON.
      // Require that exact readiness sentinel; a proxy's generic 200/HTML or
      // an empty/malformed body must never be interpreted as database health.
      const healthy = response.ok && body.trim() === 'ready';
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
    const { response, body } = await boundedFetch(
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
    let validPayload = false;
    try {
      validPayload = Array.isArray(JSON.parse(body));
    } catch {
      validPayload = false;
    }
    const healthy = response.ok && validPayload;
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
