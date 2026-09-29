import crypto from 'node:crypto';

const env = (name: string, fallback = '') => process.env[name] || fallback;

const clientId = env('YOUTUBE_CLIENT_ID');
const clientSecret = env('YOUTUBE_CLIENT_SECRET');
const productionOrigin = env('PUBLIC_APP_URL', 'https://testagram.site').replace(/\/$/, '');
const redirectUri = `${productionOrigin}/api/youtube-oauth`;
const oauthAuthorize = 'https://accounts.google.com/o/oauth2/v2/auth';
const oauthToken = 'https://oauth2.googleapis.com/token';
const scope = 'https://www.googleapis.com/auth/youtube.force-ssl';

function html(body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Testagram YouTube Authorization</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 18px;line-height:1.5}code,textarea{width:100%;box-sizing:border-box}textarea{min-height:120px;padding:12px} .ok{padding:14px;border-radius:10px;background:#eaf7ea}.err{padding:14px;border-radius:10px;background:#fdecec}</style></head><body>${body}</body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function makeState() {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const mac = crypto.createHmac('sha256', clientSecret).update(nonce).digest('base64url');
  return `${nonce}.${mac}`;
}

function validState(state: string) {
  const [nonce, mac] = state.split('.');
  if (!nonce || !mac || !clientSecret) return false;
  const expected = crypto.createHmac('sha256', clientSecret).update(nonce).digest('base64url');
  const actual = Buffer.from(mac);\n  const target = Buffer.from(expected);\n  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}

async function start() {
  if (!clientId || !clientSecret) return html('<h1>Not configured</h1><div class="err">YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be configured on the production server first.</div>', 503);
  const state = makeState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope,
    state,
  });
  const response = new Response(null, { status: 302, headers: { location: `${oauthAuthorize}?${params.toString()}` } });
  response.headers.append('set-cookie', `yt_oauth_state=${encodeURIComponent(state)}; Path=/api/youtube-oauth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  return response;
}

async function callback(url: URL, request: Request) {
  const error = url.searchParams.get('error');
  if (error) return html(`<h1>Authorization cancelled</h1><div class="err">${escapeHtml(error)}</div>`, 400);

  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const cookie = request.headers.get('cookie') || '';
  const cookieState = cookie.match(/(?:^|;\\s*)yt_oauth_state=([^;]+)/)?.[1] ? decodeURIComponent(cookie.match(/(?:^|;\\s*)yt_oauth_state=([^;]+)/)![1]) : '';

  if (!code || !state || !cookieState || state !== cookieState || !validState(state)) {
    return html('<h1>Authorization failed</h1><div class="err">OAuth state validation failed. Start again from Testagram.</div>', 400);
  }

  const tokenResponse = await fetch(oauthToken, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await tokenResponse.json().catch(() => null) as any;
  if (!tokenResponse.ok || !payload?.refresh_token) {
    return html(`<h1>Token exchange failed</h1><div class="err"><strong>${tokenResponse.status}</strong><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre></div><p>Start the authorization again. Do not reuse the authorization code.</p>`, 502);
  }

  return html(`<h1>Testagram YouTube authorization complete</h1><div class="ok"><strong>Refresh token obtained.</strong> Copy it directly into the GitHub <code>YOUTUBE_REFRESH_TOKEN</code> secret.</div><p>Do not send the token to anyone or paste it into chat.</p><textarea readonly onclick="this.select()">${escapeHtml(payload.refresh_token)}</textarea><p>After saving the GitHub secret, you can close this page. The token is not stored by this endpoint.</p>`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

export default async function handler(req: any, res: any) {
  try {
    const request = new Request(new URL(String(req.url || '/api/youtube-oauth'), `https://${req.headers?.host || 'localhost'}`).toString(), {
      method: String(req.method || 'GET').toUpperCase(),
      headers: new Headers(req.headers || {}),
    });
    if (request.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'GET required' }));
      return;
    }
    const url = new URL(request.url);
    const response = url.searchParams.has('code') || url.searchParams.has('error')
      ? await callback(url, request)
      : await start();
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  } catch {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'YOUTUBE_OAUTH_FAILED' }));
  }
}
