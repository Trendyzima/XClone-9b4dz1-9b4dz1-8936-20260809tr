export const config = { runtime: 'edge' };

// Production smoke endpoint: canonical rebuilt Supabase binding; environment overrides remain supported.
const CANONICAL_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const CANONICAL_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';

export default async function handler(_request: Request) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || CANONICAL_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || CANONICAL_PUBLISHABLE_KEY;
  try {
    const response = await fetch(url + '/rest/v1/profiles?select=id&limit=1', { headers: { apikey: key, Authorization: 'Bearer ' + key }, cache: 'no-store' });
    return new Response(JSON.stringify({ ok: response.ok, database: response.ok ? 'reachable' : 'unhealthy' }), { status: response.ok ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return new Response(JSON.stringify({ ok: false, database: 'unreachable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
}
