import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type StreamRow = {
  id: string;
  user_id: string;
  is_live: boolean;
  title: string | null;
  stream_url: string | null;
  youtube_broadcast_id: string | null;
  youtube_stream_id: string | null;
  youtube_output_id: string | null;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  },
});

const env = (name: string, fallback = '') => process.env[name] || fallback;
const supabaseUrl = env('SUPABASE_URL', env('VITE_SUPABASE_URL')).replace(/\/$/, '');
const supabaseKey = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY'))),
);
const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SECRET_KEY'));
const supabaseControlKey = supabaseServiceRoleKey || supabaseKey;
const srsMediaBaseUrl = env('SRS_MEDIA_BASE_URL', 'https://tv-media.testagram.site').replace(/\/$/, '');
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
  headers.set('authorization', `Bearer ${supabaseControlKey}`);
  if (bearer && path.startsWith('auth/v1/')) headers.set('authorization', bearer);
  return fetch(`${supabaseUrl}/${path.replace(/^\//, '')}`, { ...init, headers });
}

async function requireUser(request: Request) {
  const bearer = authHeader(request);
  if (!bearer.startsWith('Bearer ')) return null;
  const response = await supabaseFetch('auth/v1/user', { method: 'GET' }, bearer);
  if (!response.ok) return null;
  try {
    return await response.json() as { id: string };
  } catch {
    return null;
  }
}

async function getStream(streamId: string, bearer: string): Promise<StreamRow | null> {
  const query =
    `rest/v1/live_streams?id=eq.${encodeURIComponent(streamId)}&select=id,user_id,is_live,title,stream_url,youtube_broadcast_id,youtube_stream_id,youtube_output_id&limit=1`;
  const response = await supabaseFetch(query, { method: 'GET' }, bearer);
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 240);
    throw new Error(`SUPABASE_STREAM_LOOKUP_FAILED:${response.status}${detail ? `:${detail}` : ''}`);
  }
  const rows = await response.json() as StreamRow[];
  return rows[0] || null;
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function updateStream(streamId: string, patch: Record<string, unknown>, bearer: string) {
  const response = await supabaseFetch(
    `rest/v1/live_streams?id=eq.${encodeURIComponent(streamId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    },
    bearer,
  );
  if (!response.ok) throw new Error(`SUPABASE_STREAM_UPDATE_FAILED:${response.status}`);
}

async function youtubeAccessToken() {
  if (!youtubeClientId || !youtubeClientSecret || !youtubeRefreshToken) throw new Error('YOUTUBE_NOT_CONFIGURED');
  const response = await fetch(youtubeOAuthBase, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: youtubeClientId,
      client_secret: youtubeClientSecret,
      refresh_token: youtubeRefreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) throw new Error(`YOUTUBE_AUTH_FAILED:${response.status}`);
  return payload.access_token as string;
}

async function youtubeFetch(path: string, init: RequestInit = {}) {
  const accessToken = await youtubeAccessToken();
  return fetch(`${youtubeApiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function youtubeError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as any;
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || payload?.error?.message || fallback;
  return `${fallback}:${response.status}:${String(reason).slice(0, 120)}`;
}

async function createYoutubeBroadcast(title: string | null) {
  const scheduledStartTime = new Date(Date.now() + 60_000).toISOString();
  const broadcastResponse = await youtubeFetch('/liveBroadcasts?part=snippet,status,contentDetails', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title: (title || 'Testagram TV Live').slice(0, 100), description: 'Live from Testagram TV', scheduledStartTime },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
      contentDetails: { enableEmbed: true, enableDvr: false, recordFromStart: true, enableAutoStart: false, enableAutoStop: true, monitorStream: { enableMonitorStream: false } },
    }),
  });
  if (!broadcastResponse.ok) throw new Error(await youtubeError(broadcastResponse, 'YOUTUBE_BROADCAST_CREATE_FAILED'));
  const broadcastPayload = await broadcastResponse.json() as any;
  const broadcastId = broadcastPayload?.id as string | undefined;
  if (!broadcastId) throw new Error('YOUTUBE_BROADCAST_ID_MISSING');

  const streamResponse = await youtubeFetch('/liveStreams?part=snippet,cdn,status,contentDetails', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title: (title || 'Testagram TV Live').slice(0, 128) },
      cdn: { frameRate: '30fps', ingestionType: 'rtmp', resolution: '1080p' },
      contentDetails: { isReusable: false },
    }),
  });
  if (!streamResponse.ok) throw new Error(await youtubeError(streamResponse, 'YOUTUBE_STREAM_CREATE_FAILED'));
  const streamPayload = await streamResponse.json() as any;
  const streamResourceId = streamPayload?.id as string | undefined;
  const ingestionAddress = streamPayload?.cdn?.ingestionInfo?.ingestionAddress as string | undefined;
  const streamName = streamPayload?.cdn?.ingestionInfo?.streamName as string | undefined;
  if (!streamResourceId || !ingestionAddress || !streamName) throw new Error('YOUTUBE_INGESTION_INFO_MISSING');

  const bindResponse = await youtubeFetch(
    `/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamResourceId)}&part=id,status,contentDetails`,
    { method: 'POST' },
  );
  if (!bindResponse.ok) throw new Error(await youtubeError(bindResponse, 'YOUTUBE_BIND_FAILED'));

  const rtmpsIngestionAddress = streamPayload?.cdn?.ingestionInfo?.rtmpsIngestionAddress as string | undefined;
  return {
    broadcastId,
    streamId: streamResourceId,
    ingestionAddress: rtmpsIngestionAddress || ingestionAddress,
    streamKey: streamName,
    playbackUrl: `https://www.youtube.com/embed/${encodeURIComponent(broadcastId)}?autoplay=1&playsinline=1&rel=0`,
  };
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
  const response = await youtubeFetch(
    `/liveBroadcasts/transition?broadcastStatus=${encodeURIComponent(status)}&id=${encodeURIComponent(broadcastId)}&part=id,status`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(await youtubeError(response, `YOUTUBE_TRANSITION_${status.toUpperCase()}_FAILED`));
  return await response.json() as any;
}

function srsKey() {
  if (!supabaseServiceRoleKey) throw new Error('SRS_SESSION_KEY_NOT_CONFIGURED');
  return createHash('sha256').update(supabaseServiceRoleKey).digest();
}

function encodeSrsToken(payload: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', srsKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (value: Buffer) => value.toString('base64url');
  return `${b64(iv)}.${b64(tag)}.${b64(ciphertext)}`;
}

function decodeSrsToken(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null;
    const decipher = createDecipheriv('aes-256-gcm', srsKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain) as { streamId?: string; exp?: number };
    if (!payload.streamId || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function srsTokenFromParam(param: string | undefined) {
  if (!param) return '';
  try {
    return new URLSearchParams(param.replace(/^\?/, '')).get('token') || '';
  } catch {
    return '';
  }
}

async function srsForwardDestinations(streamId: string) {
  const stream = await getStream(streamId, '');
  if (!stream?.youtube_stream_id) return [];
  const youtube = await getYoutubeStream(stream.youtube_stream_id);
  const ingestion = youtube?.cdn?.ingestionInfo;
  const ingestionAddress = ingestion?.rtmpsIngestionAddress || ingestion?.ingestionAddress;
  const streamName = ingestion?.streamName;
  if (!ingestionAddress || !streamName) return [];
  return [String(ingestionAddress).replace(/\/$/, '') + '/' + encodeURIComponent(String(streamName))];
}

async function srsCallback(request: Request, action: 'auth' | 'forward') {
  const body = await request.json().catch(() => null) as any;
  if (action === 'auth' && body?.action === 'on_unpublish') {
    return isUuid(String(body?.stream || '')) ? json({ code: 0, msg: 'OK' }) : json({ code: 1, msg: 'SRS_STREAM_INVALID' }, 400);
  }

  const token = srsTokenFromParam(body?.param);
  const payload = token ? decodeSrsToken(token) : null;
  if (!payload || body?.stream !== payload.streamId || !isUuid(payload.streamId)) {
    return json({ code: 1, msg: 'SRS_STREAM_UNAUTHORIZED' }, 403);
  }

  const stream = await getStream(payload.streamId, '');
  if (!stream || !stream.youtube_stream_id) return json({ code: 1, msg: 'SRS_STREAM_NOT_READY' }, 403);
  if (action === 'auth') return json({ code: 0, msg: 'OK' });

  const destinations = await srsForwardDestinations(payload.streamId);
  return json({ code: 0, data: { urls: destinations } });
}

async function checkSrsGateway() {
  if (!srsMediaBaseUrl) throw new Error('SRS_MEDIA_NOT_CONFIGURED');
  const response = await fetch(srsMediaBaseUrl + '/healthz', {
    method: 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  if (!response || !response.ok) throw new Error('SRS_MEDIA_UNREACHABLE');
}

async function start(streamId: string, request: Request) {
  if (!srsMediaBaseUrl || !supabaseServiceRoleKey) {
    return json({ ok: false, error: { code: 'SRS_NOT_CONFIGURED', message: 'Testagram TV media gateway is not configured.' } }, 503);
  }
  if (!youtubeClientId || !youtubeClientSecret || !youtubeRefreshToken) {
    return json({ ok: false, error: { code: 'YOUTUBE_NOT_CONFIGURED', message: 'Testagram TV YouTube distribution is not configured.' } }, 503);
  }

  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to broadcast.' } }, 401);

  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream) return json({ ok: false, error: { code: 'STREAM_NOT_FOUND', message: 'No canonical live_streams record exists for this broadcast.' } }, 404);
  if (stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can publish.' } }, 403);
  if (stream.is_live) return json({ ok: false, error: { code: 'ALREADY_LIVE', message: 'This broadcast is already ON AIR.' } }, 409);

  try {
    await checkSrsGateway();
  } catch {
    return json({ ok: false, error: { code: 'SRS_MEDIA_UNREACHABLE', message: 'Testagram TV media gateway is not reachable.' } }, 503);
  }

  if (stream.youtube_broadcast_id && stream.youtube_stream_id && stream.stream_url) {
    const srsToken = encodeSrsToken({ streamId, exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 });
    const whipUrl = srsMediaBaseUrl + '/rtc/v1/whip/?app=live&stream=' + encodeURIComponent(streamId) + '&token=' + encodeURIComponent(srsToken);
    return json({
      ok: true,
      data: {
        provider: 'srs-youtube',
        token: '',
        whip_url: whipUrl,
        whep_url: null,
        playback_url: stream.stream_url,
        live_input_id: null,
        room_id: streamId,
        room_type: 'tv',
        role: 'host',
        ice_servers: [],
        youtube_broadcast_id: stream.youtube_broadcast_id,
        youtube_stream_id: stream.youtube_stream_id,
      },
      error: null,
    });
  }

  let youtubeBroadcastId: string | null = null;
  let youtubeStreamId: string | null = null;
  let controlStage = 'initializing';

  try {
    controlStage = 'youtube-create';
    const youtube = await createYoutubeBroadcast(stream.title);
    youtubeBroadcastId = youtube.broadcastId;
    youtubeStreamId = youtube.streamId;

    controlStage = 'srs-session-token';
    const srsToken = encodeSrsToken({ streamId, exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 });
    const whipUrl = srsMediaBaseUrl + '/rtc/v1/whip/?app=live&stream=' + encodeURIComponent(streamId) + '&token=' + encodeURIComponent(srsToken);

    controlStage = 'control-plane-persist';
    await updateStream(streamId, {
      is_live: false,
      stream_url: youtube.playbackUrl,
      ended_at: null,
      youtube_broadcast_id: youtubeBroadcastId,
      youtube_stream_id: youtubeStreamId,
      youtube_output_id: null,
    }, bearer);

    return json({
      ok: true,
      data: {
        provider: 'srs-youtube',
        token: '',
        whip_url: whipUrl,
        whep_url: null,
        playback_url: youtube.playbackUrl,
        live_input_id: null,
        room_id: streamId,
        room_type: 'tv',
        role: 'host',
        ice_servers: [],
        youtube_broadcast_id: youtubeBroadcastId,
        youtube_stream_id: youtubeStreamId,
      },
      error: null,
    });
  } catch (error: any) {
    if (youtubeBroadcastId) await youtubeFetch('/liveBroadcasts?id=' + encodeURIComponent(youtubeBroadcastId), { method: 'DELETE' }).catch(() => undefined);
    if (youtubeStreamId) await youtubeFetch('/liveStreams?id=' + encodeURIComponent(youtubeStreamId), { method: 'DELETE' }).catch(() => undefined);

    const message = String(error?.message || '');
    if (message === 'YOUTUBE_NOT_CONFIGURED') return json({ ok: false, error: { code: 'YOUTUBE_NOT_CONFIGURED', message: 'YouTube TV distribution credentials are missing.' } }, 503);
    if (message.startsWith('YOUTUBE_AUTH_FAILED:') || message.startsWith('YOUTUBE_BROADCAST_CREATE_FAILED:') || message.startsWith('YOUTUBE_STREAM_CREATE_FAILED:') || message.startsWith('YOUTUBE_BIND_FAILED:')) {
      return json({ ok: false, error: { code: 'YOUTUBE_CREATE_FAILED', message: 'YouTube rejected the TV broadcast setup request.', detail: message } }, 502);
    }
    console.error('[TV_START_FAILED]', { streamId, provider: 'srs-youtube', stage: controlStage, detail: message.slice(0, 260) });
    return json({ ok: false, error: { code: 'LIVE_CONTROL_FAILED', message: 'TV media control failed while preparing the broadcast.', detail: 'stage=' + controlStage + '; failure=' + message.slice(0, 260) } }, 502);
  }
}

async function viewer(streamId: string, request: Request) {
  const stream = await getStream(streamId, authHeader(request));
  if (!stream) return json({ ok: false, error: { code: 'STREAM_NOT_FOUND', message: 'No canonical live_streams record exists for this broadcast.' } }, 404);
  if (!stream.is_live || !stream.stream_url) return json({ ok: false, error: { code: 'STREAM_ENDED', message: 'Broadcast is no longer live.' } }, 409);
  if (!stream.youtube_broadcast_id || !stream.stream_url.includes('youtube.com/embed/')) {
    return json({ ok: false, error: { code: 'STREAM_PLAYBACK_NOT_READY', message: 'TV playback is not ready yet.' } }, 409);
  }
  return json({
    ok: true,
    data: {
      provider: 'srs-youtube',
      token: '',
      playback_url: stream.stream_url,
      room_id: streamId,
      room_type: 'tv',
      role: 'viewer',
      youtube_broadcast_id: stream.youtube_broadcast_id,
      title: stream.title,
      viewer_count: 0,
    },
    error: null,
  });
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
  if (diagnostics.signaling !== 'sdp-answer-received') return json({ ok: false, error: { code: 'SRS_WHIP_NOT_CONNECTED', message: 'SRS has not completed the WHIP SDP handshake yet.' }, diagnostics }, 409);
  if (!stream.youtube_broadcast_id || !stream.youtube_stream_id) return json({ ok: false, error: { code: 'STREAM_CONTROL_STATE_MISSING', message: 'YouTube distribution metadata is incomplete.' } }, 409);

  let ytStream: any = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ytStream = await getYoutubeStream(stream.youtube_stream_id);
    if (ytStream?.status?.streamStatus === 'active') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (ytStream?.status?.streamStatus !== 'active') return json({ ok: false, error: { code: 'YOUTUBE_INPUT_NOT_ACTIVE', message: 'The TV media path is not active at YouTube yet.' }, youtube_status: ytStream?.status?.streamStatus || null }, 409);

  let broadcast: any = await getYoutubeBroadcast(stream.youtube_broadcast_id);
  if (broadcast?.status?.lifeCycleStatus === 'ready') await transitionYoutubeBroadcast(stream.youtube_broadcast_id, 'live');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    broadcast = await getYoutubeBroadcast(stream.youtube_broadcast_id);
    if (broadcast?.status?.lifeCycleStatus === 'live') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (broadcast?.status?.lifeCycleStatus !== 'live') return json({ ok: false, error: { code: 'YOUTUBE_NOT_LIVE', message: 'YouTube accepted the input but the broadcast has not reached live state yet.' }, youtube_status: broadcast?.status?.lifeCycleStatus || null }, 409);

  await updateStream(streamId, { is_live: true, ended_at: null, stream_url: stream.stream_url }, bearer);
  return json({ ok: true, data: { stage: 'on-air', media_path_active: true, youtube_live: true, youtube_status: broadcast.status.lifeCycleStatus, video_rtp: true, audio_rtp: true, diagnostics }, error: null });
}

async function stop(streamId: string, request: Request) {
  const user = await requireUser(request);
  if (!user) return json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to stop the broadcast.' } }, 401);

  const bearer = authHeader(request);
  const stream = await getStream(streamId, bearer);
  if (!stream || stream.user_id !== user.id) return json({ ok: false, error: { code: 'HOST_REQUIRED', message: 'Only the broadcaster can stop this stream.' } }, 403);

  let downstreamStopped = true;
  if (stream.youtube_broadcast_id) {
    try {
      const broadcast = await getYoutubeBroadcast(stream.youtube_broadcast_id);
      if (broadcast?.status?.lifeCycleStatus === 'live' || broadcast?.status?.lifeCycleStatus === 'liveStarting') {
        await transitionYoutubeBroadcast(stream.youtube_broadcast_id, 'complete');
      }
    } catch {
      downstreamStopped = false;
    }
  }
  if (!downstreamStopped) return json({ ok: false, error: { code: 'TV_STOP_INCOMPLETE', message: 'YouTube shutdown was not confirmed; the control-plane record was left intact for reconciliation.' } }, 502);

  await updateStream(streamId, {
    is_live: false,
    ended_at: new Date().toISOString(),
    stream_url: null,
    youtube_broadcast_id: null,
    youtube_stream_id: null,
    youtube_output_id: null,
  }, bearer);

  return json({ ok: true, data: { stage: 'ended', srs_stopped: true, downstream_stopped: true }, error: null });
}

async function handle(request: Request) {
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } }, 405);

  let body: any;
  try { body = await request.json(); } catch { return json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON required.' } }, 400); }

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
    if (message === 'SRS_SESSION_KEY_NOT_CONFIGURED') return json({ ok: false, error: { code: 'SRS_NOT_CONFIGURED', message: 'Testagram server-side session key is missing.' } }, 503);
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
