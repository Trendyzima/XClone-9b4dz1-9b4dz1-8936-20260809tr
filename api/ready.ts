export const config = { runtime: 'edge' };

const CANONICAL_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const CANONICAL_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';
const DEPENDENCY_TIMEOUT_MS = 4500;

// Readiness checks the data API rather than Auth's settings endpoint: the latter
// can be healthy while Postgres/PostgREST is unavailable, and is not a DB check.
// A bounded timeout ensures readiness never hangs until the platform's own limit.
export default async function handler(_request: Request) {
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEPENDENCY_TIMEOUT_MS);
  try {
    // limit=0 avoids returning user data while still exercising PostgREST and
    // the database relation used by the application.
    const response = await fetch(
      supabaseUrl + '/rest/v1/profiles?select=id&limit=0',
      {
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal: controller.signal,
      },
    );

    const healthy = response.ok;
    return new Response(
      JSON.stringify({
        ok: healthy,
        database: healthy ? 'reachable' : 'unhealthy',
        dependency: 'postgrest',
      }),
      {
        status: healthy ? 200 : 503,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return new Response(
      JSON.stringify({
        ok: false,
        database: timedOut ? 'timeout' : 'unreachable',
        dependency: 'postgrest',
      }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
