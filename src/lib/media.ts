import { supabase } from './supabase';

// Keep public uploads aligned with the Go backend's current 20 MiB public-media gate.
// Raise this only after the backend, proxy limits, and storage policy are upgraded together.
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = new Set<string>();

export type MediaUploadResult = {
  media_id: string;
  object_key: string;
  public_url: string | null;
  size_bytes: number;
  mime_type: string;
  media_type?: 'image' | 'video' | 'audio' | 'file';
  status: 'uploaded';
  etag?: string | null;
  post_id?: string | null;
};

function validateMedia(file: File) {
  if (!file.type && !file.name) throw new Error('File type could not be determined.');
  if (file.size <= 0 || file.size > MAX_MEDIA_BYTES) throw new Error('Attachments must be 20 MiB or smaller.');
}

function selfHostedMediaBase() {
  const raw = String(import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim();
  if (!raw) {
    if (import.meta.env.VITE_TESTAGRAM_SELF_HOSTED === 'true') {
      throw new Error(
        'Self-hosted Testagram mode requires VITE_TESTAGRAM_API_URL. Refusing fallback to the hosted media path.',
      );
    }
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('VITE_TESTAGRAM_API_URL must be an absolute HTTP(S) origin.');
  }
  const isLocalHTTP =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1');
  if (
    (parsed.protocol !== 'https:' && !isLocalHTTP) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'VITE_TESTAGRAM_API_URL must be an HTTPS origin (HTTP is allowed only for localhost) without a path, credentials, query, or fragment.',
    );
  }
  return parsed.origin;
}

function resolveSelfHostedUploadURL(uploadURL: string, expectedKey: string): URL {
  const apiBase = selfHostedMediaBase();
  if (!apiBase) throw new Error('Self-hosted Testagram API URL is not configured.');
  const resolved = new URL(uploadURL, apiBase + '/');
  if (
    resolved.origin !== apiBase ||
    resolved.pathname !== '/api/media/upload' ||
    resolved.searchParams.get('key') !== expectedKey ||
    resolved.username ||
    resolved.password
  ) {
    throw new Error('Self-hosted media API returned an unsafe upload URL.');
  }
  return resolved;
}

async function selfHostedMediaRequest(path: string, body: Record<string, unknown>) {
  const base = selfHostedMediaBase();
  if (!base) throw new Error('Self-hosted Testagram API URL is not configured.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required');
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok || payload?.ok === false || payload?.error) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : String(payload?.error?.message ?? 'Self-hosted media request failed (' + response.status + ').');
    throw new Error(message);
  }
  return payload?.data ?? payload;
}

async function sha256Hex(file: File): Promise<string> {
  // Public uploads are capped at 20 MiB until the backend and proxy limits are
  // deliberately raised together, keeping WebCrypto's one-shot buffer bounded.
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function uploadMediaToSelfHosted(file: File, postId?: string | null): Promise<MediaUploadResult> {
  const mime = String(file.type ?? '').trim().toLowerCase();
  const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
  const videoTypes = new Set(['video/mp4', 'video/webm']);
  const maxBytes = imageTypes.has(mime) || videoTypes.has(mime) ? MAX_MEDIA_BYTES : 0;
  if (!maxBytes) throw new Error('Self-hosted public media supports JPEG, PNG, WebP, AVIF, GIF, MP4, and WebM up to 20 MiB only.');
  if (file.size <= 0 || file.size > maxBytes) {
    throw new Error('Public media files must be 20 MiB or smaller.');
  }

  const intent = await selfHostedMediaRequest('/api/media/upload-intent', {
    name: file.name,
    content_type: mime,
    visibility: 'public',
    size_bytes: file.size,
  });
  if (typeof intent?.url !== 'string' || !intent.url || typeof intent?.key !== 'string' || !intent.key) {
    throw new Error('Self-hosted media API returned an invalid upload intent.');
  }

  // Never send the user's bearer token to an upload URL on another origin.
  // The self-hosted API contract requires its bounded gateway endpoint.
  const uploadURL = resolveSelfHostedUploadURL(intent.url, String(intent.key));
  const checksum = await sha256Hex(file);
  const { data: { session: uploadSession } } = await supabase.auth.getSession();
  if (!uploadSession?.access_token) throw new Error('Authentication required');
  const upload = await fetch(uploadURL.toString(), {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + uploadSession.access_token,
      'Content-Type': mime,
    },
    body: file,
  });
  if (!upload.ok) {
    const failure = await upload.json().catch(() => ({} as any));
    const message = typeof failure?.error === 'string'
      ? failure.error
      : String(failure?.error?.message ?? 'Self-hosted media upload failed (' + upload.status + ').');
    throw new Error(message);
  }

  const completed = await selfHostedMediaRequest('/api/media/complete', {
    key: String(intent.key),
    visibility: 'public',
    content_type: mime,
    checksum_sha256: checksum,
  });
  return {
    media_id: String(completed.key ?? intent.key),
    object_key: String(completed.key ?? intent.key),
    public_url: typeof intent.public_url === 'string' ? intent.public_url : null,
    size_bytes: Number(completed.size_bytes ?? file.size),
    mime_type: String(completed.content_type ?? mime),
    media_type: imageTypes.has(mime) ? 'image' : 'video',
    status: 'uploaded',
    etag: typeof completed.etag === 'string' ? completed.etag : null,
    post_id: postId ?? null,
  };
}

async function mediaFunction(action: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required');
  const response = await fetch('/api/media', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(String(data?.error ?? 'Media backend request failed (' + response.status + ').'));
  return data;
}

export async function uploadMedia(file: File, postId?: string | null): Promise<MediaUploadResult> {
  if (selfHostedMediaBase()) return uploadMediaToSelfHosted(file, postId);
  validateMedia(file);
  const initialized = await mediaFunction('init', { name:file.name, mime_type:file.type.toLowerCase() || 'application/octet-stream', size_bytes:file.size, post_id:postId ?? null });
  const checksum = await sha256Hex(file);
  const { data: { session: uploadSession } } = await supabase.auth.getSession();
  if (!uploadSession?.access_token) throw new Error('Authentication required');
  const uploadURL = String(initialized.upload_url);
  const uploadHeaders: Record<string, string> = {
    'Content-Type': file.type.toLowerCase() || 'application/octet-stream',
  };
  if (new URL(uploadURL, window.location.origin).pathname === '/api/media/upload') {
    uploadHeaders.Authorization = 'Bearer ' + uploadSession.access_token;
  }
  const response = await fetch(uploadURL, {
    method: 'PUT',
    headers: uploadHeaders,
    body: file,
  });
  if (!response.ok) { await mediaFunction('delete',{media_id:initialized.media_id}).catch(()=>undefined); throw new Error('Media upload failed ('+response.status+').'); }
  return mediaFunction('complete',{media_id:initialized.media_id, checksum_sha256:checksum});
}

export async function getPrivateMediaDownloadUrl(key: string): Promise<string> {
  const data = await selfHostedMediaRequest('/api/media/private-download-url', { key });
  if (typeof data?.url !== 'string' || !data.url) throw new Error('Private media API returned an invalid download URL.');
  return data.url;
}

export async function attachMediaToPost(mediaId:string,postId:string):Promise<MediaUploadResult>{
  if (selfHostedMediaBase()) {
    const data = await selfHostedMediaRequest('/api/media/attach', { key: mediaId, post_id: postId });
    return {
      media_id: String(data.key ?? mediaId),
      object_key: String(data.key ?? mediaId),
      public_url: typeof data.public_url === 'string' ? data.public_url : null,
      size_bytes: Number(data.size_bytes ?? 0),
      mime_type: String(data.content_type ?? 'application/octet-stream'),
      media_type: data.media_type === 'image' || data.media_type === 'video' ? data.media_type : 'file',
      status: 'uploaded',
      etag: typeof data.etag === 'string' ? data.etag : null,
      post_id: postId,
    };
  }
  return mediaFunction('attach',{media_id:mediaId,post_id:postId});
}
export async function deleteMedia(mediaId:string){
  if (selfHostedMediaBase()) return selfHostedMediaRequest('/api/media/delete', { key: mediaId });
  return mediaFunction('delete',{media_id:mediaId});
}
