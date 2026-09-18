export const config = { runtime: 'edge' };

export default async function handler(_request: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return new Response(JSON.stringify({ ok: false, code: 'BACKEND_NOT_CONFIGURED' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  try {
    const response = await fetch(url + '/rest/v1/profiles?select=id&limit=1', { headers: { apikey: key, Authorization: 'Bearer ' + key }, cache: 'no-store' });
    return new Response(JSON.stringify({ ok: response.ok, database: response.ok ? 'reachable' : 'unhealthy' }), { status: response.ok ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return new Response(JSON.stringify({ ok: false, database: 'unreachable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
}
