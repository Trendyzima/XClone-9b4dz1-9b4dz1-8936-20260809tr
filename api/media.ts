// Compatibility adapter for the existing browser media client.
// Storage signing, metadata lifecycle, attachment, deletion and private access
// are owned by the Go backend. This route intentionally does not talk to R2 or
// write Supabase tables, preventing two competing media implementations.
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-request-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(res: any, status: number, body: unknown) {
  for (const [key, value] of Object.entries(corsHeaders())) res.setHeader(key, value);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

function backendOrigin() {
  const raw = String(process.env.TESTAGRAM_BACKEND_ORIGIN ?? process.env.BACKEND_API_ORIGIN ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

async function callBackend(req: any, origin: string, path: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  for (const name of ['authorization', 'apikey', 'x-client-info', 'x-request-id', 'origin']) {
    const value = req.headers?.[name];
    if (typeof value === 'string' && value.trim()) headers[name] = value;
  }
  const response = await fetch(origin + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  const raw = await response.text();
  let payload: any;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  return { status: response.status, payload };
}

function messageOf(payload: any) {
  return String(payload?.error?.message ?? payload?.error ?? payload?.message ?? 'Media operation failed');
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    for (const [key, value] of Object.entries(corsHeaders())) res.setHeader(key, value);
    return res.status(204).end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const origin = backendOrigin();
  if (!origin) return json(res, 503, { error: 'Media backend is not configured. Set TESTAGRAM_BACKEND_ORIGIN to the Go API origin.' });

  const body = req.body ?? {};
  const action = String(body.action ?? '');
  let path = '';
  let requestBody: Record<string, unknown> = {};

  switch (action) {
    case 'init': {
      const name = String(body.name ?? '').trim();
      const contentType = String(body.mime_type ?? body.content_type ?? '').trim().toLowerCase();
      const sizeBytes = Number(body.size_bytes);
      const visibility = String(body.visibility ?? 'public');
      if (!name || name.length > 255 || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
        return json(res, 400, { error: 'A file name and positive integer size_bytes are required.' });
      }
      if (!['public', 'private'].includes(visibility)) return json(res, 400, { error: 'visibility must be public or private.' });
      path = '/api/media/upload-intent';
      requestBody = { name, content_type: contentType, visibility, size_bytes: sizeBytes };
      break;
    }
    case 'complete': {
      const key = String(body.object_key ?? body.key ?? body.media_id ?? '');
      if (!key) return json(res, 400, { error: 'media_id or object_key is required.' });
      path = '/api/media/complete';
      requestBody = {
        key,
        visibility: body.visibility,
        content_type: body.content_type ?? body.mime_type,
      };
      break;
    }
    case 'attach': {
      const key = String(body.object_key ?? body.key ?? body.media_id ?? '');
      const postId = String(body.post_id ?? '');
      if (!key || !postId) return json(res, 400, { error: 'media_id and post_id are required.' });
      path = '/api/media/attach';
      requestBody = { key, post_id: postId };
      break;
    }
    case 'delete': {
      const key = String(body.object_key ?? body.key ?? body.media_id ?? '');
      if (!key) return json(res, 400, { error: 'media_id or object_key is required.' });
      path = '/api/media/delete';
      requestBody = { key };
      break;
    }
    case 'list':
      path = '/api/media/list';
      requestBody = {};
      break;
    case 'private-download':
    case 'private_download':
    case 'download': {
      const key = String(body.object_key ?? body.key ?? body.media_id ?? '');
      if (!key) return json(res, 400, { error: 'media key is required.' });
      path = '/api/media/private-download-url';
      requestBody = { key };
      break;
    }
    default:
      return json(res, 400, { error: 'Unknown media action.' });
  }

  try {
    const result = await callBackend(req, origin, path, requestBody);
    const payload = result.payload;
    if (result.status < 200 || result.status >= 300 || payload?.ok === false) {
      return json(res, result.status, {
        error: messageOf(payload),
        code: payload?.error?.code,
        request_id: payload?.request_id,
      });
    }

    const data = payload?.data ?? payload;
    if (action === 'init') {
      const expiresAt = Date.parse(String(data.expires_at ?? ''));
      return json(res, result.status, {
        media_id: data.key,
        id: data.key,
        object_key: data.key,
        upload_url: data.url,
        upload_method: data.method ?? 'PUT',
        upload_fields: data.fields ?? {},
        public_url: data.public_url,
        visibility: String(body.visibility ?? 'public'),
        mime_type: String(body.mime_type ?? body.content_type ?? ''),
        size_bytes: Number(body.size_bytes),
        expires_in: Number.isFinite(expiresAt) ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null,
        status: 'pending',
      });
    }
    if (action === 'list') return json(res, result.status, { items: data.items ?? [] });
    if (action === 'private-download' || action === 'private_download' || action === 'download') {
      return json(res, result.status, { url: data.url, expires_in: data.expires_in_seconds });
    }
    return json(res, result.status, {
      ...data,
      id: data.key ?? data.id,
      media_id: data.key ?? data.id,
      object_key: data.key ?? data.object_key ?? data.storage_key,
      storage_key: data.key ?? data.storage_key,
      public_url: data.public_url ?? data.media_url,
      size_bytes: data.size_bytes ?? data.byte_size,
    });
  } catch (error) {
    console.error('media backend proxy failed', error);
    return json(res, 502, { error: 'Media backend could not be reached.' });
  }
}
