type StreamRow = { id: string; user_id: string; is_live: boolean; title: string | null; stream_url: string | null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' },
});

const env = (name: string, fallback = '') => process.env[name] || fallback;
const supabaseUrl = env('SUPABASE_URL', env('VITE_SUPABASE_URL')).replace(/\\/$/, '');
const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY', env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))));
const cloudflareAccountId = env('CLOUDFLARE_ACCOUNT_ID');
const cloudflareApiToken = env('CLOUDFLARE_API_TOKEN');
const cloudflareApiBase = cloudflareAccountId ? `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/stream/live_inputs` : '';

const authHeader = (request: Request) => request.headers.get('authorization') || '';

async function supabaseFetch(path: string, init: RequestInit = {}, bearer = '') {
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_SERVER_NOT_CONFIGURED');
  const headers = new Headers(init.headers);
  headers.set('apikey', supabaseKey);
  headers.set('content-type', 'application/json');
  if (bearer) headers.set('authorization', bearer);
  return fetch(`${supabaseUrl}/${path.replace(/^\\//, '')}`, { ...init, headers });
}

async function requireUser(request: Request) {
  const bearer = authHeader(request);
  if (!bearer.startsWith('Bearer ')) return null;
  const response = await supabaseFetch('auth/v1/user', { method: 'GET' }, bearer);
  if (!response.ok) return null;
  try { return await response.json() as { id: string }; } catch { return null; }
}

async function getStream(streamId: string, bearer: string): Promise<StreamRow | null> {
  const query = `rest/v1/live_streams?id=eq.${encodeURIComponent(streamId)}&select=id,user_id,is_live,title,stream_url&limit=1`;
  const response = await supabaseFetch(query, { method: 'GET' }, bearer);
  if (!response.ok) return null;
  const rows = await response.json() as StreamRow[];
  return rows[0] || null;
}

async function updateStream(streamId: string, patch: Record<string, unknown>, bearer: string) {
  const response = await supabaseFetch(`rest/v1/live_streams?id=eq.${encodeURIComponent(streamId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  }, bearer);
  if (!response.ok) throw new Error(`SUPABASE_STREAM_UPDATE_FAILED:${response.status}`);
}

const cloudflareFetch = (url: string, init: RequestInit = {}) => fetch(url, {
  ...init,
  headers: {
    authorization: `Bearer ${cloudflareApiToken}`,
    'content-type': 'application/json',
    ...(init.headers || {}),
  },
});

function inputIdFromWhep(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.cloudflarestream.com')) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const webRtcIndex = parts.indexOf('webRTC');
    if (webRtcIndex <= 0 || parts[webRtcIndex + 1] !== 'play') return null;
    const id = parts[webRtcIndex - 1];
    return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : null;
  } catch { return null; }
}

async function getCloudflareInput(inputId: string) {
  const response = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(inputId)}`, { method: 'GET' });
  if (!response.ok) return null;
  const payload = await response.json() as any;
  return payload?.success && payload?.result ? payload.result : null;
}

async function lifecycleFromWhep(whepUrl: string) {
  try {
    const parsed = new URL(whepUrl);
    const inputId = inputIdFromWhep(whepUrl);
    if (!inputId) return null;
    const lifecycle = await fetch(`${parsed.origin}/${inputId}/lifecycle`, { method: 'GET', cache: 'no-store' });
    if (!lifecycle.ok) return null;
    return await lifecycle.json() as { isInput?: boolean; live?: boolean; videoUID?: string | null };
  } catch { return null; }
}

async function start(streamId: string, request: Request) {
  if (!cloudflareAccountId || !cloudflareApiToken) return json({ ok: false, error: { code: 'CLOUDFLARE_STREAM_NOT_CONFIGURED', message: 'Vercel Cloudflare Stream credentials are not configured.', missing: [!cloudflareAccountId ? 'CLOUDFLARE_ACCOUNT_ID' : null, !cloudflareApiToken ? 'CLOUDFLARE_API_TOKEN' : null].filter(Boolean) } }, 503);
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to broadcast.' } }, 401);
  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream) return json({ ok: false, error: { code: 'STREAM_NOT_FOUND', message: 'TV broadcast was not found.' } }, 404);
  if (stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can publish.' } }, 403);

  if (stream.is_live && stream.stream_url) {
    const lifecycle = await lifecycleFromWhep(stream.stream_url);
    if (lifecycle?.live) return json({ ok: false, error: { code: 'ALREADY_LIVE', message: 'This broadcast is already ON AIR.' } }, 409);
  }

  let input: any = null;
  const existingInputId = inputIdFromWhep(stream.stream_url);
  if (existingInputId) {
    input = await getCloudflareInput(existingInputId);
    if (input?.uid) {
      const enable = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(existingInputId)}`, { method: 'PUT', body: JSON.stringify({ enabled: true }) });
      if (!enable.ok) input = null;
      else { const enabledPayload = await enable.json() as any; input = enabledPayload?.result || input; }
    }
  }

  if (!input?.uid || !input?.webRTC?.url || !input?.webRTCPlayback?.url) {
    const response = await cloudflareFetch(cloudflareApiBase, {
      method: 'POST',
      headers: { 'Idempotency-Key': streamId },
      body: JSON.stringify({ defaultCreator: user.id, enabled: true, meta: { testagram_stream_id: streamId, title: stream.title || 'Testagram TV Live' }, recording: { mode: 'off' } }),
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || !payload?.success || !payload?.result) {
      return json({ ok: false, error: { code: 'CLOUDFLARE_STREAM_CREATE_FAILED', message: 'Could not create the Cloudflare Stream live input.', status: response.status, provider_error: payload?.errors?.[0]?.message || null } }, 502);
    }
    input = payload.result;
  }

  const whipUrl = input.webRTC?.url || '';
  const whepUrl = input.webRTCPlayback?.url || '';
  if (!input.uid || !whipUrl || !whepUrl) return json({ ok: false, error: { code: 'CLOUDFLARE_WEBRTC_ENDPOINTS_MISSING', message: 'Cloudflare did not return both WebRTC endpoints.' } }, 502);

  await updateStream(streamId, { is_live: false, stream_url: whepUrl, ended_at: null }, bearer);
  return json({ ok: true, data: { provider: 'cloudflare-stream', token: '', whip_url: whipUrl, whep_url: whepUrl, live_input_id: input.uid, room_id: streamId, room_type: 'tv', role: 'host', ice_servers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }, error: null });
}

async function viewer(streamId: string, request: Request) {
  const stream = await getStream(streamId, authHeader(request));
  if (!stream) return json({ ok: false, error: { code: 'STREAM_NOT_FOUND', message: 'TV broadcast was not found.' } }, 404);
  if (!stream.is_live || !stream.stream_url) return json({ ok: false, error: { code: 'STREAM_ENDED', message: 'Broadcast is no longer live.' } }, 409);
  if (!inputIdFromWhep(stream.stream_url)) return json({ ok: false, error: { code: 'STREAM_PLAYBACK_NOT_READY', message: 'Cloudflare Stream playback is not ready yet.' } }, 409);
  return json({ ok: true, data: { provider: 'cloudflare-stream', token: '', whep_url: stream.stream_url, room_id: streamId, room_type: 'tv', role: 'viewer', ice_servers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }, error: null });
}

async function verify(streamId: string, request: Request) {
  if (!cloudflareAccountId || !cloudflareApiToken) return json({ ok: false, error: { code: 'CLOUDFLARE_STREAM_NOT_CONFIGURED', message: 'Vercel Cloudflare Stream credentials are not configured.' } }, 503);
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to verify the broadcast.' } }, 401);
  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream || stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can verify this stream.' } }, 403);
  const body = await request.json().catch(() => ({})) as any;
  const diagnostics = body?.diagnostics || {};
  const videoOk = Number(diagnostics.videoPackets) > 0 && Number(diagnostics.videoBytes) > 0;
  const audioOk = Number(diagnostics.audioPackets) > 0 && Number(diagnostics.audioBytes) > 0;
  if (!videoOk) return json({ ok: false, error: { code: 'VIDEO_RTP_FAILED', message: 'Cloudflare negotiation completed but the browser has not transmitted video RTP.' }, diagnostics }, 409);
  if (!audioOk) return json({ ok: false, error: { code: 'AUDIO_RTP_FAILED', message: 'Cloudflare negotiation completed but the browser has not transmitted audio RTP.' }, diagnostics }, 409);
  if (!stream.stream_url) return json({ ok: false, error: { code: 'STREAM_PLAYBACK_NOT_READY', message: 'No Cloudflare playback endpoint is stored.' } }, 409);
  let lifecycle: { isInput?: boolean; live?: boolean; videoUID?: string | null } | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    lifecycle = await lifecycleFromWhep(stream.stream_url);
    if (lifecycle?.live) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!lifecycle?.live) return json({ ok: false, error: { code: 'CLOUDFLARE_INPUT_NOT_LIVE', message: 'Cloudflare has not reported the live input as active yet.' }, lifecycle }, 409);
  await updateStream(streamId, { is_live: true, ended_at: null, stream_url: stream.stream_url }, bearer);
  return json({ ok: true, data: { stage: 'on-air', cloudflare_live: true, video_rtp: true, audio_rtp: true, video_uid: lifecycle.videoUID || null, diagnostics }, error: null });
}

async function stop(streamId: string, request: Request) {
  if (!cloudflareAccountId || !cloudflareApiToken) return json({ ok: false, error: { code: 'CLOUDFLARE_STREAM_NOT_CONFIGURED', message: 'Vercel Cloudflare Stream credentials are not configured.' } }, 503);
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to stop the broadcast.' } }, 401);
  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream || stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can stop this stream.' } }, 403);
  const inputId = inputIdFromWhep(stream.stream_url);
  let cloudflareStopped = true;
  if (inputId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(inputId)}`, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
      cloudflareStopped = response.ok;
      if (cloudflareStopped) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (!cloudflareStopped) return json({ ok: false, error: { code: 'CLOUDFLARE_STOP_FAILED', message: 'Cloudflare did not confirm input shutdown; Testagram kept the stream marked live to avoid false OFF AIR state.' } }, 502);
  await updateStream(streamId, { is_live: false, ended_at: new Date().toISOString(), stream_url: null }, bearer);
  return json({ ok: true, data: { stage: 'ended', cloudflare_stopped: true }, error: null });
}

export default { async fetch(request: Request) {
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } }, 405);
  let body: any; try { body = await request.json(); } catch { return json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON required.' } }, 400); }
  const streamId = typeof body?.stream_id === 'string' ? body.stream_id : '';
  const action = typeof body?.action === 'string' ? body.action : '';
  if (!streamId) return json({ ok: false, error: { code: 'STREAM_ID_REQUIRED', message: 'stream_id is required.' } }, 400);
  try {
    if (action === 'start') return await start(streamId, request);
    if (action === 'viewer') return await viewer(streamId, request);
    if (action === 'verify') return await verify(streamId, request);
    if (action === 'stop') return await stop(streamId, request);
    return json({ ok: false, error: { code: 'ACTION_REQUIRED', message: 'Supported actions: start, viewer, verify, stop.' } }, 400);
  } catch (error: any) {
    const message = String(error?.message || 'Vercel live control failed.');
    if (message === 'SUPABASE_SERVER_NOT_CONFIGURED') return json({ ok: false, error: { code: 'SUPABASE_SERVER_NOT_CONFIGURED', message: 'Vercel Supabase server configuration is missing.' } }, 503);
    return json({ ok: false, error: { code: 'LIVE_CONTROL_FAILED', message: 'Vercel live control failed.' } }, 500);
  }
} };
