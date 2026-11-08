import { requireAccessToken } from '@/services/backendClient';

export type MediaCompleted = {
  key: string;
  media_id?: string;
  object_key: string;
  mime_type: string;
  media_type: 'image' | 'video' | 'audio' | 'file';
  status: string;
  media_url: string | null;
  etag?: string | null;
  size_bytes: number;
  public_url: string | null;
};

type ApiEnvelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } | null };

export const MAX_TESTAGRAM_MEDIA_BYTES = 20 * 1024 * 1024;
const API = '/api/media';

function friendlyMediaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/Failed to fetch|NetworkError|Load failed|network|connection/i.test(message)) return 'Connection interrupted while uploading. Please try again.';
  if (/401|Authentication required|sign in again/i.test(message)) return 'Your session expired. Please sign in again.';
  if (/413|20 MiB|too large|FILE_TOO_LARGE/i.test(message)) return 'That file is too large. Maximum size is 20 MiB.';
  return message || 'Media upload failed. Please try again.';
}

async function apiRequest<T>(path: string, token: string, method: 'POST' | 'PUT', body?: unknown, contentType?: string): Promise<T> {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body: body as BodyInit | undefined,
    credentials: 'omit',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload?.ok || payload.data == null) {
    throw new Error(payload?.error?.message || 'Testagram media API failed (' + response.status + ').');
  }
  return payload.data;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function uploadAttempt(file: File, accessTokenOverride?: string): Promise<MediaCompleted> {
  const token = accessTokenOverride ?? await requireAccessToken();
  const contentType = file.type || 'application/octet-stream';
  const intent = await apiRequest<{ key: string; url: string; public_url?: string }>(
    '/upload-intent',
    token,
    'POST',
    JSON.stringify({ name: file.name, content_type: contentType, visibility: 'public', size_bytes: file.size }),
    'application/json',
  );
  if (!intent.key || !intent.url) throw new Error('Backend returned an incomplete media upload intent.');

  const upload = await fetch(intent.url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType },
    body: file,
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!upload.ok) throw new Error('Media upload failed (' + upload.status + ').');

  const completed = await apiRequest<MediaCompleted>(
    '/complete',
    token,
    'POST',
    JSON.stringify({ key: intent.key, visibility: 'public', content_type: contentType, checksum_sha256: await sha256Hex(file) }),
    'application/json',
  );
  return {
    ...completed,
    media_id: completed.media_id ?? completed.key,
    object_key: completed.object_key ?? completed.key,
    mime_type: completed.mime_type ?? contentType,
    media_url: completed.media_url ?? completed.public_url ?? intent.public_url ?? null,
    size_bytes: Number(completed.size_bytes ?? file.size),
    public_url: completed.public_url ?? intent.public_url ?? null,
  };
}

export async function uploadTestagramMedia(file: File, _postId?: string | null, _threadId?: string | null, accessTokenOverride?: string): Promise<MediaCompleted> {
  try {
    if (file.size <= 0) throw new Error('The selected file is empty.');
    if (file.size > MAX_TESTAGRAM_MEDIA_BYTES) throw new Error('That file is too large. Maximum size is 20 MiB.');
    return await uploadAttempt(file, accessTokenOverride);
  } catch (error) {
    throw new Error(friendlyMediaError(error));
  }
}

export async function attachTestagramMedia(mediaId: string, postId: string, accessTokenOverride?: string): Promise<void> {
  const token = accessTokenOverride ?? await requireAccessToken();
  const key = String(mediaId ?? '').trim();
  const target = String(postId ?? '').trim();
  if (!key || !target) throw new Error('Media attachment could not start because the media or post ID was missing.');
  await apiRequest('/attach', token, 'POST', JSON.stringify({ key, media_id: key, post_id: target }), 'application/json');
}

export async function deleteTestagramMedia(mediaId: string, accessTokenOverride?: string): Promise<void> {
  const key = String(mediaId ?? '').trim();
  if (!key) return;
  const token = accessTokenOverride ?? await requireAccessToken();
  await apiRequest('/delete', token, 'POST', JSON.stringify({ key, media_id: key }), 'application/json');
}
