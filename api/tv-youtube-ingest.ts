import { createServer } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { WebSocketServer } from 'ws';
import ffmpegPath from 'ffmpeg-static';

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const getEncoderConfig = async (streamId: string, token: string) => {
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase TV control is not configured.');
  const response = await fetch(supabaseUrl + '/functions/v1/tv-media-control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey },
    body: JSON.stringify({ action: 'youtube-encoder-config', stream_id: streamId, encoder_token: token }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.data?.rtmps_ingestion_address || !payload?.data?.stream_name) {
    throw new Error(payload?.error?.message || 'YouTube encoder configuration is unavailable.');
  }
  return payload.data as { rtmps_ingestion_address: string; stream_name: string };
};

const server = createServer((_request, response) => {
  response.statusCode = 426;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ ok: false, error: { message: 'WebSocket connection required.' } }));
});

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });

wss.on('connection', (socket, request) => {
  const requestUrl = new URL(request.url || '/', 'https://tv.testagram.local');
  const streamId = requestUrl.searchParams.get('stream_id') || '';
  const encoderToken = requestUrl.searchParams.get('encoder_token') || '';
  const directIngestAddress = requestUrl.searchParams.get('rtmps_ingestion_address') || '';
  const directStreamName = requestUrl.searchParams.get('stream_name') || '';

  if (!streamId || (!encoderToken && (!directIngestAddress || !directStreamName))) {
    socket.close(1008, 'YouTube encoder session is required.');
    return;
  }
  if (!ffmpegPath) {
    socket.close(1011, 'FFmpeg encoder binary is unavailable.');
    return;
  }

  let ffmpeg: ChildProcessWithoutNullStreams | null = null;
  let initialized = false;

  const closeEncoder = () => {
    if (!ffmpeg) return;
    try { ffmpeg.stdin.end(); } catch {}
    try { ffmpeg.kill('SIGTERM'); } catch {}
    ffmpeg = null;
  };

  socket.on('message', async (data, isBinary) => {
    if (!isBinary) return;
    try {
      if (!initialized) {
        const config = encoderToken
          ? await getEncoderConfig(streamId, encoderToken)
          : { rtmps_ingestion_address: directIngestAddress, stream_name: directStreamName };
        const ingest = config.rtmps_ingestion_address.replace(/\/$/, '') + '/' + config.stream_name;
        ffmpeg = spawn(ffmpegPath as string, [
          '-hide_banner', '-loglevel', 'warning',
          '-fflags', '+genpts',
          '-f', 'webm', '-i', 'pipe:0',
          '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
          '-pix_fmt', 'yuv420p', '-r', '30',
          '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
          '-b:v', '8M', '-maxrate', '8M', '-bufsize', '16M',
          '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
          '-f', 'flv', ingest,
        ]);
        initialized = true;
        ffmpeg.stderr.on('data', chunk => {
          const line = String(chunk).trim();
          if (line) console.warn('[TV YouTube encoder]', line.slice(0, 500));
        });
        ffmpeg.on('error', error => {
          try { socket.send(JSON.stringify({ type: 'error', message: 'YouTube encoder process failed: ' + error.message })); } catch {}
          closeEncoder();
          try { socket.close(1011, 'encoder failed'); } catch {}
        });
        ffmpeg.on('exit', code => {
          if (code !== 0 && socket.readyState === socket.OPEN) {
            try { socket.send(JSON.stringify({ type: 'error', message: 'YouTube encoder stopped unexpectedly (' + code + ').' })); } catch {}
          }
          ffmpeg = null;
        });
        socket.send(JSON.stringify({ type: 'ready' }));
      }
      if (ffmpeg?.stdin.writable) ffmpeg.stdin.write(Buffer.isBuffer(data) ? data : Buffer.from(data as any));
    } catch (error: any) {
      try { socket.send(JSON.stringify({ type: 'error', message: error?.message || 'Could not start YouTube encoder.' })); } catch {}
      closeEncoder();
      try { socket.close(1011, 'encoder setup failed'); } catch {}
    }
  });

  socket.on('close', closeEncoder);
  socket.on('error', closeEncoder);
});

export default server;
