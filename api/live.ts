import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type StreamRow = { id: string; user_id: string; is_live: boolean; title: string | null; stream_url: string | null; mux_live_stream_id: string | null; mux_playback_id: string | null; cloudflare_input_id: string | null; cloudflare_output_id: string | null; youtube_broadcast_id: string | null; youtube_stream_id: string | null; youtube_output_id: string | null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' },
});

const env = (name: string, fallback = '') => process.env[name] || fallback;
const supabaseUrl = env('SUPABASE_URL', env('VITE_SUPABASE_URL')).replace(/\/$/, '');
const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY', env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))));
const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SECRET_KEY'));
const supabaseControlKey = supabaseServiceRoleKey || supabaseKey;
const srsMediaBaseUrl = env('SRS_MEDIA_BASE_URL').replace(/\/$/, '');
const srsApiUrl = env('SRS_API_URL').replace(/\/$/, '');
const srsApiToken = env('SRS_API_TOKEN');
const srsForwardSecret = env('SRS_FORWARD_SECRET');
const muxTokenId = env('MUX_TOKEN_ID');
const muxTokenSecret = env('MUX_TOKEN_SECRET');
const muxApiBase = 'https://api.mux.com/video/v1';
const tvDistributionProvider = env('TV_DISTRIBUTION_PROVIDER', 'srs').toLowerCase();
const tvSecondaryDistribution = env('TV_SECONDARY_DISTRIBUTION', '').toLowerCase();
const youtubeClientId = env('YOUTUBE_CLIENT_ID');
const youtubeClientSecret = env('YOUTUBE_CLIENT_SECRET');
const youtubeRefreshToken = env('YOUTUBE_REFRESH_TOKEN');
const youtubeApiBase = 'https://www.googleapis.com/youtube/v3';
const youtubeOAuthBase = 'https://oauth2.googleapis.com/token';

const authHeader = (request: Request) => request.headers.get('authorization') || '';

async function supabaseFetch(path: string, init: RequestInit = {}, bearer = '') {
  if (!supabaseUrl || !supabaseControlKey) throw new Error('SUPABASE_SERVER_NOT_CONFIGURED');
  const headers = new Headers(init.headers);
  headers.set('apikey', supabaseControlKey);
  headers.set('content-type', 'application/json');
  // Control-plane queries must authenticate as the server role. A user JWT in
  // Authorization would re-enable RLS even when apikey is the service-role key.
  headers.set('authorization', `Bearer ${supabaseControlKey}`);
  if (bearer && path.startsWith('auth/v1/')) headers.set('authorization', bearer);
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
  const query = `rest/v1/live_streams?id=eq.${encodeURIComponent(streamId)}&select=id,user_id,is_live,title,stream_url,mux_live_stream_id,mux_playback_id,cloudflare_input_id,cloudflare_output_id,youtube_broadcast_id,youtube_stream_id,youtube_output_id&limit=1`;
  const response = await supabaseFetch(query, { method: 'GET' }, bearer);
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 240);
    throw new Error(`SUPABASE_STREAM_LOOKUP_FAILED:${response.status}${detail ? `:${detail}` : ''}`);
  }
  const rows = await response.json() as StreamRow[];
  return rows[0] || null;
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

async function createCloudflareOutput(inputId: string, url: string, streamKey: string) {
  const response = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(inputId)}/outputs`, { method: 'POST', body: JSON.stringify({ url, streamKey, enabled: true }) });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.success || !payload?.result?.uid) { const code = payload?.errors?.[0]?.code; const reason = payload?.errors?.[0]?.message; throw new Error(`CLOUDFLARE_OUTPUT_FAILED:${response.status}:${String(code || 'unknown')}:${String(reason || 'Cloudflare rejected the output').slice(0, 160)}`); }
  return payload.result as { uid: string };
}

async function youtubeAccessToken() {
  if (!youtubeClientId || !youtubeClientSecret || !youtubeRefreshToken) throw new Error('YOUTUBE_NOT_CONFIGURED');
  const response = await fetch(youtubeOAuthBase, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: youtubeClientId, client_secret: youtubeClientSecret, refresh_token: youtubeRefreshToken, grant_type: 'refresh_token' }) });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) throw new Error(`YOUTUBE_AUTH_FAILED:${response.status}`);
  return payload.access_token as string;
}

async function youtubeFetch(path: string, init: RequestInit = {}) {
  const accessToken = await youtubeAccessToken();
  return fetch(`${youtubeApiBase}${path}`, { ...init, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...(init.headers || {}) } });
}

async function youtubeError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as any;
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || payload?.error?.message || fallback;
  return `${fallback}:${response.status}:${String(reason).slice(0, 120)}`;
}

async function createYoutubeBroadcast(title: string | null) {
  const scheduledStartTime = new Date(Date.now() + 60_000).toISOString();
  const broadcastResponse = await youtubeFetch('/liveBroadcasts?part=snippet,status,contentDetails', { method: 'POST', body: JSON.stringify({ snippet: { title: (title || 'Testagram TV Live').slice(0, 100), description: 'Live from Testagram TV', scheduledStartTime }, status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false }, contentDetails: { enableEmbed: true, enableDvr: false, recordFromStart: true, enableAutoStart: false, enableAutoStop: false, monitorStream: { enableMonitorStream: false } } }) });
  if (!broadcastResponse.ok) throw new Error(await youtubeError(broadcastResponse, 'YOUTUBE_BROADCAST_CREATE_FAILED'));
  const broadcastPayload = await broadcastResponse.json() as any;
  const broadcastId = broadcastPayload?.id as string | undefined;
  if (!broadcastId) throw new Error('YOUTUBE_BROADCAST_ID_MISSING');
  const streamResponse = await youtubeFetch('/liveStreams?part=snippet,cdn,status,contentDetails', { method: 'POST', body: JSON.stringify({ snippet: { title: (title || 'Testagram TV Live').slice(0, 128) }, cdn: { frameRate: '30fps', ingestionType: 'rtmp', resolution: '1080p' }, contentDetails: { isReusable: false } }) });
  if (!streamResponse.ok) throw new Error(await youtubeError(streamResponse, 'YOUTUBE_STREAM_CREATE_FAILED'));
  const streamPayload = await streamResponse.json() as any;
  const streamResourceId = streamPayload?.id as string | undefined;
  const ingestionAddress = streamPayload?.cdn?.ingestionInfo?.ingestionAddress as string | undefined;
  const streamName = streamPayload?.cdn?.ingestionInfo?.streamName as string | undefined;
  if (!streamResourceId || !ingestionAddress || !streamName) throw new Error('YOUTUBE_INGESTION_INFO_MISSING');
  const bindResponse = await youtubeFetch(`/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamResourceId)}&part=id,status,contentDetails`, { method: 'POST' });
  if (!bindResponse.ok) throw new Error(await youtubeError(bindResponse, 'YOUTUBE_BIND_FAILED'));
  const rtmpsIngestionAddress = streamPayload?.cdn?.ingestionInfo?.rtmpsIngestionAddress as string | undefined;
  return { broadcastId, streamId: streamResourceId, ingestionAddress: rtmpsIngestionAddress || ingestionAddress, streamKey: streamName, playbackUrl: `https://www.youtube.com/embed/${encodeURIComponent(broadcastId)}?autoplay=1&playsinline=1&rel=0` };
}

async function getYoutubeStream(streamId: string) {
  const response = await youtubeFetch(`/liveStreams?part=status,cdn&id=${encodeURIComponent(streamId)}`, { method: 'GET' });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as any;
  return payload?.items?.[0] || null;
}

async function getYoutubeBroadcast(broadcastId: string) {
  const response = await youtubeFetch(`/liveBroadcasts?part=status,contentDetails&id=${encodeURIComponent(broadcastId)}`, { method: 'GET' });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as any;
  return payload?.items?.[0] || null;
}

async function transitionYoutubeBroadcast(broadcastId: string, status: 'live' | 'complete') {
  const response = await youtubeFetch(`/liveBroadcasts/transition?broadcastStatus=${encodeURIComponent(status)}&id=${encodeURIComponent(broadcastId)}&part=id,status`, { method: 'POST' });
  if (!response.ok) throw new Error(await youtubeError(response, `YOUTUBE_TRANSITION_${status.toUpperCase()}_FAILED`));
  return await response.json() as any;
}

async function disableCloudflareOutput(inputId: string, outputId: string) {
  const response = await cloudflareFetch(`${cloudflareApiBase}/${encodeURIComponent(inputId)}/outputs/${encodeURIComponent(outputId)}`, { method: 'DELETE' });
  return response.ok || response.status === 404;
}

async function deleteMuxLiveStream(liveStreamId: string) {
  if (!muxTokenId || !muxTokenSecret) return false;
  const response = await muxFetch(`/live-streams/${encodeURIComponent(liveStreamId)}`, { method: 'DELETE' });
  return response.ok || response.status === 404;
}

function srsKey() {
  if (!srsForwardSecret) throw new Error('SRS_FORWARD_NOT_CONFIGURED');
  return createHash('sha256').update(srsForwardSecret).digest();
}

function encodeSrsToken(payload: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', srsKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (v: Buffer) => v.toString('base64url');
  return b64(iv) + '.' + b64(tag) + '.' + b64(ciphertext);
}

function decodeSrsToken(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64url'); const tag = Buffer.from(parts[1], 'base64url'); const ciphertext = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null;
    const decipher = createDecipheriv('aes-256-gcm', srsKey(), iv); decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain) as { streamId?: string; exp?: number; destinations?: string[] };
    if (!payload.streamId || !payload.exp || payload.exp < Math.floor(Date.now() / 1000) || !Array.isArray(payload.destinations)) return null;
    return payload;
  } catch { return null; }
}

function srsTokenFromParam(param: string | undefined) {
  if (!param) return '';
  try { return new URLSearchParams(param.replace(/^\?/, '')).get('token') || ''; } catch { return ''; }
}

async function srsApi(path: string) {
  if (!srsApiUrl || !srsApiToken) throw new Error('SRS_API_NOT_CONFIGURED');
  return fetch(srsApiUrl + path, { headers: { authorization: 'Bearer ' + srsApiToken }, cache: 'no-store' });
}

async function srsStreamIsLive(streamId: string) {
  const response = await srsApi('/api/v1/streams?start=0&count=100');
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null) as any;
  const rows = Array.isArray(payload?.streams) ? payload.streams : Array.isArray(payload?.data?.streams) ? payload.data.streams : [];
  return rows.some((row: any) => row?.stream === streamId && row?.publish?.active === true);
}

async function srsCallback(request: Request, action: 'auth' | 'forward') {
  if (!srsForwardSecret) return json({ code: 1, msg: 'SRS_FORWARD_NOT_CONFIGURED' }, 503);
  const body = await request.json().catch(() => null) as any;
  const token = srsTokenFromParam(body?.param);
  const payload = token ? decodeSrsToken(token) : null;
  if (!payload || body?.stream !== payload.streamId) return json({ code: 1, msg: 'SRS_STREAM_UNAUTHORIZED' }, 403);
  if (action === 'auth') return json({ code: 0, msg: 'OK' });
  return json({ code: 0, data: { urls: payload.destinations } });
}
async function start(streamId: string, request: Request) {
  if (!srsMediaBaseUrl || !srsForwardSecret) return json({ ok: false, error: { code: 'SRS_NOT_CONFIGURED', message: 'Testagram TV media gateway is not configured.' } }, 503);
  if (tvDistributionProvider !== 'srs') return json({ ok: false, error: { code: 'TV_DISTRIBUTION_INVALID', message: 'TV_DISTRIBUTION_PROVIDER must be srs for the production TV path.' } }, 503);
  if (!youtubeClientId || !youtubeClientSecret || !youtubeRefreshToken) return json({ ok: false, error: { code: 'YOUTUBE_NOT_CONFIGURED', message: 'Testagram TV YouTube distribution is not configured.' } }, 503);
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to broadcast.' } }, 401);
  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream) return json({ ok: false, error: { code: 'STREAM_NOT_FOUND', message: 'No canonical live_streams record exists for this broadcast.' } }, 404);
  if (stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can publish.' } }, 403);
  if (stream.is_live) return json({ ok: false, error: { code: 'ALREADY_LIVE', message: 'This broadcast is already ON AIR.' } }, 409);
  let youtubeBroadcastId: string | null = null; let youtubeStreamId: string | null = null; let muxLiveStreamId: string | null = null; let controlStage = 'initializing';
  try {
    controlStage = 'youtube-create';
    const youtube = await createYoutubeBroadcast(stream.title);
    youtubeBroadcastId = youtube.broadcastId; youtubeStreamId = youtube.streamId;
    const destinations = [youtube.ingestionAddress.replace(/\/$/, '') + '/' + encodeURIComponent(youtube.streamKey)];
    if (tvSecondaryDistribution === 'mux') {
      controlStage = 'mux-secondary-create';
      const mux = await createMuxLiveStream(streamId, stream.title); muxLiveStreamId = mux.id;
      destinations.push('rtmps://global-live.mux.com:443/app/' + mux.streamKey);
    }
    controlStage = 'srs-session-token';
    const srsToken = encodeSrsToken({ streamId, exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60, destinations });
    const whipUrl = srsMediaBaseUrl + '/rtc/v1/whip/?app=live&stream=' + encodeURIComponent(streamId) + '&token=' + encodeURIComponent(srsToken);
    controlStage = 'control-plane-persist';
    await updateStream(streamId, { is_live: false, stream_url: youtube.playbackUrl, ended_at: null, mux_live_stream_id: muxLiveStreamId, mux_playback_id: null, cloudflare_input_id: null, cloudflare_output_id: null, youtube_broadcast_id: youtubeBroadcastId, youtube_stream_id: youtubeStreamId, youtube_output_id: null }, bearer);
    return json({ ok: true, data: { provider: 'srs-youtube-hybrid', token: '', whip_url: whipUrl, whep_url: null, playback_url: youtube.playbackUrl, live_input_id: null, room_id: streamId, room_type: 'tv', role: 'host', ice_servers: [], youtube_broadcast_id: youtubeBroadcastId, youtube_stream_id: youtubeStreamId, secondary_provider: muxLiveStreamId ? 'mux' : null }, error: null });
  } catch (error: any) {
    if (youtubeBroadcastId) await youtubeFetch('/liveBroadcasts?id=' + encodeURIComponent(youtubeBroadcastId), { method: 'DELETE' }).catch(() => undefined);
    if (youtubeStreamId) await youtubeFetch('/liveStreams?id=' + encodeURIComponent(youtubeStreamId), { method: 'DELETE' }).catch(() => undefined);
    if (muxLiveStreamId) await deleteMuxLiveStream(muxLiveStreamId).catch(() => undefined);
    const message = String(error?.message || '');
    if (message === 'SRS_FORWARD_NOT_CONFIGURED') return json({ ok: false, error: { code: 'SRS_NOT_CONFIGURED', message: 'SRS forwarding credentials are missing.' } }, 503);
    if (message === 'YOUTUBE_NOT_CONFIGURED') return json({ ok: false, error: { code: 'YOUTUBE_NOT_CONFIGURED', message: 'YouTube TV distribution credentials are missing.' } }, 503);
    if (message.startsWith('YOUTUBE_AUTH_FAILED:') || message.startsWith('YOUTUBE_BROADCAST_CREATE_FAILED:') || message.startsWith('YOUTUBE_STREAM_CREATE_FAILED:') || message.startsWith('YOUTUBE_BIND_FAILED:')) return json({ ok: false, error: { code: 'YOUTUBE_CREATE_FAILED', message: 'YouTube rejected the TV broadcast setup request.', detail: message } }, 502);
    if (message === 'MUX_NOT_CONFIGURED' || message === 'MUX_ENDPOINTS_MISSING' || message === 'MUX_CREATE_FAILED') return json({ ok: false, error: { code: message, message: 'The optional Mux secondary distribution could not be created.', detail: message } }, 502);
    console.error('[TV_START_FAILED]', { streamId, provider: 'srs', stage: controlStage, detail: message.slice(0, 260) });
    return json({ ok: false, error: { code: 'LIVE_CONTROL_FAILED', message: 'TV media control failed while preparing the SRS distribution path.', detail: 'stage=' + controlStage + '; failure=' + message.slice(0, 260) } }, 502);
  }
}
async function verify(streamId: string, request: Request) {
  const user = await requireUser(request); if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to verify the broadcast.' } }, 401);
  const bearer = authHeader(request); const stream = await getStream(streamId, bearer);
  if (!stream || stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can verify this stream.' } }, 403);
  const body = await request.json().catch(() => ({})) as any; const diagnostics = body?.diagnostics || {};
  if (!(Number(diagnostics.videoPackets) > 0 && Number(diagnostics.videoBytes) > 0)) return json({ ok: false, error: { code: 'VIDEO_RTP_FAILED', message: 'The browser has not transmitted video RTP.' }, diagnostics }, 409);
  if (!(Number(diagnostics.audioPackets) > 0 && Number(diagnostics.audioBytes) > 0)) return json({ ok: false, error: { code: 'AUDIO_RTP_FAILED', message: 'The browser has not transmitted audio RTP.' }, diagnostics }, 409);
  let srsLive = false; for (let attempt = 0; attempt < 20; attempt += 1) { try { srsLive = await srsStreamIsLive(streamId); } catch { srsLive = false; } if (srsLive) break; await new Promise(resolve => setTimeout(resolve, 750)); }
  if (!srsLive) return json({ ok: false, error: { code: 'SRS_INPUT_NOT_LIVE', message: 'SRS has not reported the TV input as active yet.' }, diagnostics }, 409);
  if (!stream.youtube_broadcast_id || !stream.youtube_stream_id) return json({ ok: false, error: { code: 'STREAM_CONTROL_STATE_MISSING', message: 'YouTube distribution metadata is incomplete.' } }, 409);
  let ytStream: any = null; for (let attempt = 0; attempt < 30; attempt += 1) { ytStream = await getYoutubeStream(stream.youtube_stream_id); if (ytStream?.status?.streamStatus === 'active') break; await new Promise(resolve => setTimeout(resolve, 1000)); }
  if (ytStream?.status?.streamStatus !== 'active') return json({ ok: false, error: { code: 'YOUTUBE_INPUT_NOT_ACTIVE', message: 'SRS is live, but YouTube has not activated the downstream ingest yet.' }, youtube_status: ytStream?.status?.streamStatus || null }, 409);
  let broadcast: any = await getYoutubeBroadcast(stream.youtube_broadcast_id); if (broadcast?.status?.lifeCycleStatus === 'ready') await transitionYoutubeBroadcast(stream.youtube_broadcast_id, 'live');
  for (let attempt = 0; attempt < 30; attempt += 1) { broadcast = await getYoutubeBroadcast(stream.youtube_broadcast_id); if (broadcast?.status?.lifeCycleStatus === 'live') break; await new Promise(resolve => setTimeout(resolve, 1000)); }
  if (broadcast?.status?.lifeCycleStatus !== 'live') return json({ ok: false, error: { code: 'YOUTUBE_NOT_LIVE', message: 'YouTube accepted the input but the broadcast has not reached live state yet.' }, youtube_status: broadcast?.status?.lifeCycleStatus || null }, 409);
  await updateStream(streamId, { is_live: true, ended_at: null, stream_url: stream.stream_url }, bearer);
  return json({ ok: true, data: { stage: 'on-air', srs_live: true, youtube_live: true, youtube_status: broadcast.status.lifeCycleStatus, video_rtp: true, audio_rtp: true, diagnostics }, error: null });
}
async function stop(streamId: string, request: Request) {
  const user = await requireUser(request); if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to stop the broadcast.' } }, 401);
  const bearer = authHeader(request); const stream = await getStream(streamId, bearer);
  if (!stream || stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can stop this stream.' } }, 403);
  let downstreamStopped = true;
  if (stream.youtube_broadcast_id) { try { const broadcast = await getYoutubeBroadcast(stream.youtube_broadcast_id); if (broadcast?.status?.lifeCycleStatus === 'live' || broadcast?.status?.lifeCycleStatus === 'liveStarting') await transitionYoutubeBroadcast(stream.youtube_broadcast_id, 'complete'); } catch { downstreamStopped = false; } }
  if (!downstreamStopped) return json({ ok: false, error: { code: 'TV_STOP_INCOMPLETE', message: 'YouTube shutdown was not confirmed; the control-plane record was left intact for reconciliation.' } }, 502);
  if (stream.mux_live_stream_id) await deleteMuxLiveStream(stream.mux_live_stream_id).catch(() => undefined);
  await updateStream(streamId, { is_live: false, ended_at: new Date().toISOString(), stream_url: null, mux_live_stream_id: null, mux_playback_id: null, cloudflare_input_id: null, cloudflare_output_id: null, youtube_broadcast_id: null, youtube_stream_id: null, youtube_output_id: null }, bearer);
  return json({ ok: true, data: { stage: 'ended', srs_stopped: true, downstream_stopped: true }, error: null });
}
async function handle(request: Request) {
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } }, 405);
  let body: any; try { body = await request.json(); } catch { return json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON required.' } }, 400); }
  const streamId = typeof body?.stream_id === 'string' ? body.stream_id : '';
  const action = typeof body?.action === 'string' ? body.action : '';
  const srsAction = new URL(request.url).searchParams.get('srs');
  if (srsAction === 'auth') return await srsCallback(request, 'auth');
  if (srsAction === 'forward') return await srsCallback(request, 'forward');
  if (!streamId) return json({ ok: false, error: { code: 'STREAM_ID_REQUIRED', message: 'stream_id is required.' } }, 400);
  if (!isUuid(streamId)) return json({ ok: false, error: { code: 'STREAM_ID_INVALID', message: 'stream_id must be the canonical live_streams UUID, not a route slug or generated navigation ID.' } }, 400);
  try {
    if (action === 'start') return await start(streamId, request);
    if (action === 'viewer') return await viewer(streamId, request);
    if (action === 'verify') return await verify(streamId, request);
    if (action === 'stop') return await stop(streamId, request);
    return json({ ok: false, error: { code: 'ACTION_REQUIRED', message: 'Supported actions: start, viewer, verify, stop.' } }, 400);
  } catch (error: any) {
    const message = String(error?.message || 'Vercel live control failed. [stage=unknown; inspect runtime diagnostics]');
    if (message === 'SRS_API_NOT_CONFIGURED') return json({ ok: false, error: { code: 'SRS_API_NOT_CONFIGURED', message: 'SRS control API credentials are missing.' } }, 503);
    if (message === 'SUPABASE_SERVER_NOT_CONFIGURED') return json({ ok: false, error: { code: 'SUPABASE_SERVER_NOT_CONFIGURED', message: 'Vercel Supabase server configuration is missing.' } }, 503);
    if (message.startsWith('SUPABASE_STREAM_LOOKUP_FAILED:')) return json({ ok: false, error: { code: 'STREAM_LOOKUP_FAILED', message: 'Supabase rejected the TV broadcast lookup; this is a control-plane access/configuration failure, not a missing broadcast.', detail: message.slice('SUPABASE_STREAM_LOOKUP_FAILED:'.length) } }, 502);
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
