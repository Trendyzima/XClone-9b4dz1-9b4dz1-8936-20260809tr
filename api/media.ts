// Thin compatibility adapter from the existing Testagram client contract to the
// self-hosted Go media API. Object storage signing, metadata lifecycle, ownership,
// post attachment, deletion, and private downloads are owned by the Go backend;
// this route must not create a second R2 implementation.
function env(name: string, fallback = '') { return process.env[name] ?? fallback; }

const CDN_BASE = env('MEDIA_PUBLIC_BASE_URL', 'https://media.testagram.site/v1').replace(/\\/$/, '');

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

function mediaUrl(key: string) {
  return CDN_BASE + '/' + key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function errorMessage(body: any, fallback: string) {
  return body?.error?.message ?? body?.error ?? fallback;
}

async function backendPost(origin: string, path: string, authorization: string, body: unknown, requestId: string) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Request-ID': requestId,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { response, data };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    for (const [key, value] of Object.entries(corsHeaders())) res.setHeader(key, value);
    return res.status(204).end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const origin = env('TESTAGRAM_MEDIA_BACKEND_ORIGIN', env('TESTAGRAM_BACKEND_ORIGIN')).replace(/\\/$/, '');
  if (!origin || !/^https?:\\/\\//i.test(origin)) {
    return json(res, 503, { error: 'The Testagram media backend is not configured.' });
  }

  const authorization = String(req.headers.authorization ?? '').trim();
  if (!/^Bearer\\s+\\S+/i.test(authorization) || /[\\r\\n]/.test(authorization)) {
    return json(res, 401, { error: 'Authentication required' });
  }
  const requestId = String(req.headers['x-request-id'] ?? '').slice(0, 128) || 'media-client';
  const body = req.body ?? {};
  const action = String(body.action ?? '');
  const key = String(body.object_key ?? body.key ?? body.media_id ?? '').trim();

  try {
    if (action === 'init') {
      const name = String(body.name ?? '').trim();
      const contentType = String(body.mime_type ?? body.content_type ?? '').trim().toLowerCase();
      const sizeBytes = Number(body.size_bytes);
      const visibility = String(body.visibility ?? 'public');
      if (!name || name.length > 255 || !contentType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        return json(res, 400, { error: 'name, mime_type and a positive size_bytes are required' });
      }
      if (body.post_id) {
        // The backend validates ownership when attach is called. Do not bind an
        // upload to a post during intent creation, which keeps retries idempotent.
      }
      const { response, data } = await backendPost(origin, '/api/media/upload-intent', authorization, {
        name, content_type: contentType, visibility, size_bytes: sizeBytes,
      }, requestId);
      if (!response.ok || !data?.ok || !data?.data?.key || !data?.data?.url) {
        return json(res, response.status, { error: errorMessage(data, 'Unable to create upload intent') });
      }
      const intent = data.data;
      return json(res, 200, {
        media_id: intent.key,
        object_key: intent.key,
        upload_url: intent.url,
        method: intent.method ?? 'PUT',
        public_url: visibility === 'public' ? mediaUrl(intent.key) : null,
        visibility,
        mime_type: contentType,
        size_bytes: sizeBytes,
        expires_at: intent.expires_at,
        expires_in: Math.max(0, Math.floor((Date.parse(intent.expires_at) - Date.now()) / 1000)),
      });
    }

    if (action === 'complete') {
      if (!key) return json(res, 400, { error: 'media_id or object_key is required' });
      const { response, data } = await backendPost(origin, '/api/media/complete', authorization, {
        key, visibility: body.visibility, content_type: body.mime_type ?? body.content_type,
      }, requestId);
      if (!response.ok || !data?.ok) return json(res, response.status, { error: errorMessage(data, 'Unable to complete media upload') });
      const asset = data.data ?? {};
      return json(res, response.status, {
        ...asset,
        media_id: key,
        object_key: key,
        size_bytes: asset.size_bytes,
        mime_type: asset.content_type ?? body.mime_type ?? body.content_type,
        public_url: asset.visibility === 'public' ? mediaUrl(key) : null,
      });
    }

    if (action === 'attach') {
      const postId = String(body.post_id ?? '').trim();
      if (!key || !postId) return json(res, 400, { error: 'media_id/object_key and post_id are required' });
      const { response, data } = await backendPost(origin, '/api/media/attach', authorization, { key, post_id: postId }, requestId);
      if (!response.ok || !data?.ok) return json(res, response.status, { error: errorMessage(data, 'Unable to attach media to post') });
      const asset = data.data ?? {};
      return json(res, response.status, {
        ...asset,
        media_id: key,
        object_key: key,
        public_url: asset.visibility === 'private' ? null : mediaUrl(key),
      });
    }

    if (action === 'private-download') {
      if (!key) return json(res, 400, { error: 'media_id or object_key is required' });
      const { response, data } = await backendPost(origin, '/api/media/private-download-url', authorization, { key }, requestId);
      if (!response.ok || !data?.ok) return json(res, response.status, { error: errorMessage(data, 'Unable to authorize private media download') });
      return json(res, response.status, { url: data.data?.url, expires_in: data.data?.expires_in_seconds });
    }

    if (action === 'delete') {
      if (!key) return json(res, 400, { error: 'media_id or object_key is required' });
      const { response, data } = await backendPost(origin, '/api/media/delete', authorization, { key }, requestId);
      if (!response.ok || !data?.ok) return json(res, response.status, { error: errorMessage(data, 'Unable to delete media') });
      return json(res, response.status, { ok: true });
    }

    if (action === 'list') {
      return json(res, 501, { error: 'Media listing is not part of the upload lifecycle API yet.' });
    }

    return json(res, 400, { error: 'Unknown media action' });
  } catch (error) {
    console.error('media backend proxy failed', error);
    return json(res, 502, { error: 'Media backend is temporarily unavailable.' });
  }
}
