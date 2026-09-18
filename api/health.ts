export const config = { runtime: 'edge' };

function present(name: string) {
  return Boolean(process.env[name]);
}

export default async function handler(request: Request) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, code: 'METHOD_NOT_ALLOWED' }), {
      status: 405, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const checks = {
    supabaseConfig: Boolean(url && key),
    supabaseServiceRole: present('SUPABASE_SERVICE_ROLE_KEY') || present('SUPABASE_SECRET_KEY'),
    r2Config: present('R2_ACCOUNT_ID') && present('R2_ACCESS_KEY_ID') && present('R2_SECRET_ACCESS_KEY') && present('R2_MEDIA_BUCKET'),
    appOrigin: present('APP_ORIGIN'),
  };

  if (!checks.supabaseConfig || !checks.supabaseServiceRole || !checks.r2Config || !checks.appOrigin) {
    return new Response(JSON.stringify({ ok: false, code: 'BACKEND_NOT_CONFIGURED', checks }), {
      status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  try {
    const response = await fetch(url + '/rest/v1/profiles?select=id&limit=1', {
      headers: { apikey: key!, Authorization: 'Bearer ' + key! },
      cache: 'no-store',
    });
    const ok = response.ok;
    return new Response(JSON.stringify({ ok, checks, database: ok ? 'reachable' : 'unhealthy' }), {
      status: ok ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, checks, database: 'unreachable' }), {
      status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}
