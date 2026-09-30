import { experimental_upgradeWebSocket, type WebSocketData } from '@vercel/functions';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const jsonError = (message: string, status = 400) => new Response(JSON.stringify({ ok: false, error: { message } }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const getEncoderConfig = async (streamId: string, token: string, auth: string) => {
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase TV control is not configured.');
  const response = await fetch(supabaseUrl + '/functions/v1/tv-media-control', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify({ action: 'youtube-encoder-config', stream_id: streamId, encoder_token: token }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.data?.rtmps_ingestion_address || !payload?.data?.stream_name) {
    throw new Error(payload?.error?.message || 'YouTube encoder configuration is unavailable.');
  }
  return payload.data as { rtmps_ingestion_address: string; stream_name: string };
};

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const streamId = url.searchParams.get('stream_id') || '';
  const encoderToken = url.searchParams.get('encoder_token') || '';
  const directIngestAddress = url.searchParams.get('rtmps_ingestion_address') || '';
  const directStreamName = url.searchParams.get('stream_name') || '';
  const authorization = '';
  if (!streamId || (!encoderToken && (!directIngestAddress || !directStreamName))) return jsonError('YouTube encoder session is required.', 401);
  if (!ffmpegPath) return jsonError('FFmpeg encoder binary is unavailable.', 503);

  return experimental_upgradeWebSocket((socket) => {
    let ffmpeg: ChildProcessWithoutNullStreams | null = null;
    let initialized = false;

    const closeEncoder = () => {
      if (!ffmpeg) return;
      try { ffmpeg.stdin.end(); } catch {}
      try { ffmpeg.kill('SIGTERM'); } catch {}
      ffmpeg = null;
    };

    socket.on('message', async (data: WebSocketData, isBinary: boolean) => {
      if (!isBinary) return;
      try {
        if (!initialized) {
          const config = encoderToken
            ? await getEncoderConfig(streamId, encoderToken, authorization)
            : { rtmps_ingestion_address: directIngestAddress, stream_name: directStreamName };
          const ingest = config.rtmps_ingestion_address.replace(/\/$/, '') + '/' + config.stream_name;
          ffmpeg = spawn(ffmpegPath as string, [
            '-hide_banner', '-loglevel', 'warning',
            '-fflags', '+genpts',
            '-f', 'webm', '-i', 'pipe:0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p', '-r', '30',
            '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
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
  }, { maxPayload: 2 * 1024 * 1024 });
};

export default GET;
