type StreamRow = { id: string; user_id: string; is_live: boolean; title: string | null; stream_url: string | null; mux_live_stream_id: string | null; mux_playback_id: string | null; cloudflare_input_id: string | null; cloudflare_output_id: string | null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' },
});

const env = (name: string, fallback = '') => process.env[name] || fallback;
const supabaseUrl = env('SUPABASE_URL', env('VITE_SUPABASE_URL')).replace(/\/$/, '');
const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY', env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))));
const cloudflareAccountId = env('CLOUDFLARE_ACCOUNT_ID');
const cloudflareApiToken = env('CLOUDFLARE_API_TOKEN');
const cloudflareApiBase = cloudflareAccountId ? `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/stream/live_inputs` : '';
const muxTokenId = env('MUX_TOKEN_ID');
const muxTokenSecret = env('MUX_TOKEN_SECRET');
const muxApiBase = 'https://api.mux.com/video/v1';

const authHeader = (request: Request) => request.headers.get('authorization') || '';

async function supabaseFetch(path: string, init: RequestInit = {}, bearer = '') {
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_SERVER_NOT_CONFIGURED');
  const headers = new Headers(init.headers);
  headers.set('apikey', supabaseKey);
  headers.set('content-type', 'application/json');
  if (bearer) headers.set('authorization', bearer);
  return fetch(`${supabaseUrl}/${path.replace(/^\//, '')}`, { ...init, headers });
}

async function requireUser(request: Request) {
  const bearer = authHeader(request);
  if (!bearer.startsWith('Bearer ')) return null;
  const response = await supabaseFetch('auth/v1/user', { method: 'GET' }, bearer);
  if (!response.ok) return null;
  try { return await response.json() as { id: string }; } catch { return null; }
}

async function getStream(streamId: string, bearer: string): Promise<StreamRow | null> {
  const query = `rest/v1/live_streams?id=eq.${encodeURIComponent(streamId)}&select=id,user_id,is_live,title,stream_url,mux_live_stream_id,mux_playback_id,cloudflare_input_id,cloudflare_output_id&limit=1`;
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

function customerCodeFromLocator(locator: string | null) {
  if (!locator) return null;
  try {
    const host = new URL(locator).hostname;
    const match = host.match(/^customer-([a-z0-9]+)\.cloudflarestream\.com$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function streamAllowedOrigins() {
  const raw = env('CLOUDFLARE_STREAM_ALLOWED_ORIGINS');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(value => String(value).trim()).filter(Boolean);
  } catch {}
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function streamHlsUrl(inputId: string, locator: string | null) {
  const customerCode = customerCodeFromLocator(locator);
  if (!customerCode) return null;
  return `https://customer-${customerCode}.cloudflarestream.com/${encodeURIComponent(inputId)}/manifest/video.m3u8`;
}

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

function inputIdFromLocator(url: string | null) {
  if (!url) return null;
  const whep = inputIdFromWhep(url);
  if (whep) return whep;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.cloudflarestream.com')) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const manifestIndex = parts.indexOf('manifest');
    const id = manifestIndex > 0 ? parts[manifestIndex - 1] : '';
    return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : null;
  } catch { return null; }
}

function whepFromInputId(inputId: string, locator: string | null) {
  const customerCode = customerCodeFromLocator(locator);
  if (!customerCode) return null;
  return `https://customer-${customerCode}.cloudflarestream.com/${encodeURIComponent(inputId)}/webRTC/play`;
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

const muxAuth = () => `Basic ${Buffer.from(`${muxTokenId}:${muxTokenSecret}`).toString('base64')}`;

const muxFetch = (path: string, init: RequestInit = {}) => fetch(`${muxApiBase}${path}`, {
  ...init,
  headers: { authorization: muxAuth(), 'content-type': 'application/json', ...(init.headers || {}) },
});

async function createMuxLiveStream(streamId: string, title: string | null) {
  if (!muxTokenId || !muxTokenSecret) throw new Error('MUX_NOT_CONFIGURED');
  const response = await muxFetch('/live-streams', {
    method: 'POST',
    body: JSON.stringify({
      latency_mode: 'low',
      playback_policies: ['public'],
      new_asset_settings: { playback_policies: ['public'], meta: { external_id: streamId, title: title || 'Testagram TV Live' } },
      meta: { title: title || 'Testagram TV Live', external_id: streamId },
    }),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.data?.id) throw new Error('MUX_CREATE_FAILED');
  const data = payload.data;
  const playbackId = data.playback_ids?.find((item: any) => item?.policy === 'public')?.id || data.playback_ids?.[0]?.id || null;
  if (!data.stream_key || !playbackId) throw new Error('MUX_ENDPOINTS_MISSING');
  return { id: data.id as string, streamKey: data.stream_key as string, playbackId: playbackId as string, playbackUrl: `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8` };
}

async function getMuxLiveStream(liveStreamId: string) {
  if (!muxTokenId || !muxTokenSecret) return null;
  const response = await muxFetch(`/live-streams/${encodeURIComponent(liveStreamId)}`, { method: 'GET' });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as any;
  return payload?.data || null;
}

async function createCloudflareMuxOutput(inputId: string, muxStreamKey: string) {
  const response = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(inputId)}/outputs`, {
    method: 'POST',
    body: JSON.stringify({ url: 'rtmps://global-live.mux.com:443/app', streamKey: muxStreamKey, enabled: true }),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.success || !payload?.result?.uid) throw new Error('CLOUDFLARE_MUX_OUTPUT_FAILED');
  return payload.result as { uid: string };
}

async function disableCloudflareOutput(inputId: string, outputId: string) {
  const response = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(inputId)}/outputs/${encodeURIComponent(outputId)}`, { method: 'DELETE' });
  return response.ok;
}

async function start(streamId: string, request: Request) {
  if (!cloudflareAccountId || !cloudflareApiToken) return json({ ok: false, error: { code: 'CLOUDFLARE_STREAM_NOT_CONFIGURED', message: 'Vercel Cloudflare Stream credentials are not configured.' } }, 503);
  if (!muxTokenId || !muxTokenSecret) return json({ ok: false, error: { code: 'MUX_NOT_CONFIGURED', message: 'Vercel Mux Video API credentials are not configured for Testagram TV.' } }, 503);
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to broadcast.' } }, 401);
  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream) return json({ ok: false, error: { code: 'STREAM_NOT_FOUND', message: 'TV broadcast was not found.' } }, 404);
  if (stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can publish.' } }, 403);
  if (stream.is_live) return json({ ok: false, error: { code: 'ALREADY_LIVE', message: 'This broadcast is already ON AIR.' } }, 409);

  try {
    const mux = await createMuxLiveStream(streamId, stream.title);
    const response = await cloudflareFetch(cloudflareApiBase, {
      method: 'POST',
      headers: { 'Idempotency-Key': `tv-${streamId}` },
      body: JSON.stringify({ defaultCreator: user.id, enabled: true, deleteRecordingAfterDays: 30, meta: { testagram_stream_id: streamId, title: stream.title || 'Testagram TV Live' }, preferLowLatency: true, recording: { mode: 'automatic', allowedOrigins: streamAllowedOrigins() } }),
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || !payload?.success || !payload?.result?.uid || !payload?.result?.webRTC?.url || !payload?.result?.webRTCPlayback?.url) throw new Error('CLOUDFLARE_STREAM_CREATE_FAILED');
    const input = payload.result;
    const output = await createCloudflareMuxOutput(input.uid, mux.streamKey);
    await updateStream(streamId, { is_live: false, stream_url: mux.playbackUrl, ended_at: null, mux_live_stream_id: mux.id, mux_playback_id: mux.playbackId, cloudflare_input_id: input.uid, cloudflare_output_id: output.uid }, bearer);
    return json({ ok: true, data: { provider: 'cloudflare-mux-hybrid', token: '', whip_url: input.webRTC.url, whep_url: input.webRTCPlayback.url, playback_url: mux.playbackUrl, live_input_id: input.uid, room_id: streamId, room_type: 'tv', role: 'host', ice_servers: [{ urls: 'stun:stun.cloudflare.com:3478' }], mux_playback_id: mux.playbackId }, error: null });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message === 'MUX_NOT_CONFIGURED') return json({ ok: false, error: { code: 'MUX_NOT_CONFIGURED', message: 'Vercel Mux Video API credentials are not configured for Testagram TV.' } }, 503);
    if (message === 'MUX_ENDPOINTS_MISSING') return json({ ok: false, error: { code: 'MUX_ENDPOINTS_MISSING', message: 'Mux did not return a usable stream key and playback ID.' } }, 502);
    if (message === 'CLOUDFLARE_MUX_OUTPUT_FAILED') return json({ ok: false, error: { code: 'CLOUDFLARE_MUX_OUTPUT_FAILED', message: 'Cloudflare could not attach the Mux restream output.' } }, 502);
    return json({ ok: false, error: { code: message === 'MUX_CREATE_FAILED' ? 'MUX_CREATE_FAILED' : 'LIVE_CONTROL_FAILED', message: 'TV media control failed while preparing the Cloudflare-to-Mux path.' } }, 502);
  }
}
async function viewer(streamId: string, request: Request) {
  const stream = await getStream(streamId, authHeader(request));
  if (!stream) return json({ ok: false, error: { code: 'STREAM_NOT_FOUND', message: 'TV broadcast was not found.' } }, 404);
  if (!stream.is_live || !stream.stream_url) return json({ ok: false, error: { code: 'STREAM_ENDED', message: 'Broadcast is no longer live.' } }, 409);
  if (!stream.stream_url.includes('stream.mux.com/')) return json({ ok: false, error: { code: 'STREAM_PLAYBACK_NOT_READY', message: 'Mux playback is not ready yet.' } }, 409);
  return json({ ok: true, data: { provider: 'cloudflare-mux-hybrid', token: '', playback_url: stream.stream_url, room_id: streamId, room_type: 'tv', role: 'viewer', mux_playback_id: stream.mux_playback_id }, error: null });
}
async function verify(streamId: string, request: Request) {
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to verify the broadcast.' } }, 401);
  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream || stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can verify this stream.' } }, 403);
  const body = await request.json().catch(() => ({})) as any;
  const diagnostics = body?.diagnostics || {};
  if (!(Number(diagnostics.videoPackets) > 0 && Number(diagnostics.videoBytes) > 0)) return json({ ok: false, error: { code: 'VIDEO_RTP_FAILED', message: 'The browser has not transmitted video RTP.' }, diagnostics }, 409);
  if (!(Number(diagnostics.audioPackets) > 0 && Number(diagnostics.audioBytes) > 0)) return json({ ok: false, error: { code: 'AUDIO_RTP_FAILED', message: 'The browser has not transmitted audio RTP.' }, diagnostics }, 409);
  if (!stream.cloudflare_input_id || !stream.mux_live_stream_id) return json({ ok: false, error: { code: 'STREAM_CONTROL_STATE_MISSING', message: 'TV media control metadata is incomplete.' } }, 409);
  let lifecycle: any = null;
  const input = await getCloudflareInput(stream.cloudflare_input_id);
  if (input?.status === 'connected' || input?.status === 'reconnected') lifecycle = { live: true, videoUID: input.uid };
  if (!lifecycle) {
    const whepUrl = whepFromInputId(stream.cloudflare_input_id, stream.stream_url);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      lifecycle = whepUrl ? await lifecycleFromWhep(whepUrl) : null;
      if (lifecycle?.live) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!lifecycle?.live) return json({ ok: false, error: { code: 'CLOUDFLARE_INPUT_NOT_LIVE', message: 'Cloudflare has not reported the TV input as active yet.' } }, 409);
  let muxLive: any = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    muxLive = await getMuxLiveStream(stream.mux_live_stream_id);
    if (muxLive?.status === 'active' || muxLive?.status === 'recording') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!muxLive || !['active', 'recording'].includes(muxLive.status)) return json({ ok: false, error: { code: 'MUX_INPUT_NOT_ACTIVE', message: 'Cloudflare is receiving the broadcast, but Mux has not activated the downstream live stream yet.' }, mux_status: muxLive?.status || null }, 409);
  await updateStream(streamId, { is_live: true, ended_at: null, stream_url: stream.stream_url }, bearer);
  return json({ ok: true, data: { stage: 'on-air', cloudflare_live: true, mux_live: true, mux_status: muxLive.status, video_rtp: true, audio_rtp: true, diagnostics }, error: null });
}
async function stop(streamId: string, request: Request) {
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to stop the broadcast.' } }, 401);
  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream || stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can stop this stream.' } }, 403);
  if (stream.cloudflare_input_id) {
    if (stream.cloudflare_output_id) await disableCloudflareOutput(stream.cloudflare_input_id, stream.cloudflare_output_id);
    const response = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(stream.cloudflare_input_id)}`, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    if (!response.ok) return json({ ok: false, error: { code: 'CLOUDFLARE_STOP_FAILED', message: 'Cloudflare did not confirm TV input shutdown; Testagram kept the stream marked live.' } }, 502);
  }
  await updateStream(streamId, { is_live: false, ended_at: new Date().toISOString(), stream_url: null, mux_live_stream_id: null, mux_playback_id: null, cloudflare_input_id: null, cloudflare_output_id: null }, bearer);
  return json({ ok: true, data: { stage: 'ended', cloudflare_stopped: true, mux_stopped: true }, error: null });
}
async function handle(request: Request) {
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
}

export default async function handler(req: any, res: any) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const rawBody = typeof req.body === 'string' ? req.body : (req.body == null ? undefined : JSON.stringify(req.body));
    const request = new Request(new URL(String(req.url || '/'), `https://${req.headers?.host || 'localhost'}`).toString(), {
      method,
      headers: new Headers(req.headers || {}),
      body: method === 'GET' || method === 'HEAD' ? undefined : rawBody,
    });
    const response = await handle(request);
    res.statusCode = response.status;
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    res.end(await response.text());
  } catch {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: { code: 'LIVE_CONTROL_FAILED', message: 'Vercel live control failed.' } }));
  }
}
