import { testagramApi } from '@/services/testagramApi';
import { TestagramApiError } from '@/services/testagramApiClient';

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = new Set<string>([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm',
]);

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

type UploadReservation = {
  reservation_id: string;
  object_id: string;
  upload_url: string;
  upload_method: string;
  required_headers: Record<string, string>;
  expires_at: string;
  reserved_bytes: number;
  status: string;
};

export class MediaApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(message: string, status: number, code: string | null = null, requestId: string | null = null) {
    super(message);
    this.name = 'MediaApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function validateMedia(file: File): string {
  const mime = String(file.type || '').trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(mime)) {
    throw new MediaApiError('Choose a supported image, video, or audio format.', 415, 'MEDIA_TYPE_NOT_ALLOWED');
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_MEDIA_BYTES) {
    throw new MediaApiError('Attachments must be between 1 byte and 20 MiB.', 413, 'MEDIA_SIZE_NOT_ALLOWED');
  }
  return mime;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateUploadURL(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new MediaApiError('Media service returned an invalid upload URL.', 502, 'UPLOAD_URL_INVALID'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
    throw new MediaApiError('Media service returned an unsafe upload URL.', 502, 'UPLOAD_URL_UNSAFE');
  }
  return url;
}

function uploadHeaders(required: Record<string, string>, mime: string): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(required ?? {})) {
    if (key.toLowerCase() !== 'content-type' || value.toLowerCase() !== mime) {
      throw new MediaApiError('Media service returned unsupported upload headers.', 502, 'UPLOAD_HEADERS_INVALID');
    }
    headers.set('Content-Type', value);
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', mime);
  return headers;
}

function classifyMedia(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Uploads to the B2 primary origin using a short-lived, Backend-issued URL.
 * Backend verifies the B2 object, replicates it to R2, then commits metadata
 * and quota state through Appwrite. The browser never receives storage keys.
 */
export async function uploadMedia(file: File, postId?: string | null): Promise<MediaUploadResult> {
  if (postId) {
    throw new MediaApiError(
      'Media storage is available, but attaching media to posts is not yet exposed by the Backend API.',
      503,
      'MEDIA_ATTACH_NOT_PORTED',
    );
  }

  const mime = validateMedia(file);
  const checksum = await sha256Hex(file);
  const idempotencyKey = globalThis.crypto.randomUUID();
  const reservation = await testagramApi.request<UploadReservation>('/v1/media/uploads/reservations', {
    method: 'POST',
    idempotencyKey,
    body: {
      bytes: file.size,
      content_type: mime,
      sha256: checksum,
      scope: 'post_media',
    },
  });

  if (!reservation?.reservation_id || !reservation.object_id || !reservation.upload_url ||
      reservation.upload_method !== 'PUT' || reservation.status !== 'reserved') {
    throw new MediaApiError('Backend returned an invalid media upload reservation.', 502, 'UPLOAD_RESERVATION_INVALID');
  }

  const uploadURL = validateUploadURL(reservation.upload_url);
  const response = await fetch(uploadURL.toString(), {
    method: 'PUT',
    headers: uploadHeaders(reservation.required_headers, mime),
    body: file,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) {
    throw new MediaApiError(
      'Primary media upload failed (HTTP ' + response.status + '). The reservation will expire automatically if it cannot be retried.',
      response.status,
      'MEDIA_PRIMARY_UPLOAD_FAILED',
    );
  }

  // Completion is safe to retry with the same reservation: the Backend state
  // machine recognizes an already-protected object and never reserves quota twice.
  const completePath = '/v1/media/uploads/' + encodeURIComponent(reservation.reservation_id) + '/complete';
  try {
    await testagramApi.request(completePath, {
      method: 'POST',
      body: {},
      idempotencyKey,
      timeoutMs: 30_000,
    });
  } catch (firstError) {
    const retryable = firstError instanceof TestagramApiError &&
      (firstError.status === 0 || firstError.status === 502 || firstError.status === 503 || firstError.status === 504);
    if (!retryable) throw firstError;
    await testagramApi.request(completePath, {
      method: 'POST',
      body: {},
      idempotencyKey,
      timeoutMs: 30_000,
    });
  }

  return {
    media_id: reservation.object_id,
    object_key: reservation.object_id,
    public_url: null,
    size_bytes: file.size,
    mime_type: mime,
    media_type: classifyMedia(mime),
    status: 'uploaded',
    post_id: null,
  };
}

export async function getPrivateMediaDownloadUrl(objectId: string): Promise<string> {
  const id = objectId.trim();
  if (!id || id.length > 128 || /[\\r\\n/]/.test(id)) {
    throw new MediaApiError('Media object ID is invalid.', 400, 'MEDIA_ID_INVALID');
  }
  const result = await testagramApi.request<{ url?: string }>('/v1/media/' + encodeURIComponent(id) + '/download');
  if (typeof result?.url !== 'string' || !result.url) {
    throw new MediaApiError('Backend returned an invalid private media URL.', 502, 'MEDIA_DOWNLOAD_URL_INVALID');
  }
  return result.url;
}

export async function attachMediaToPost(_mediaId: string, _postId: string): Promise<MediaUploadResult> {
  throw new MediaApiError(
    'Attaching media to posts is not yet exposed by the Backend API.',
    503,
    'MEDIA_ATTACH_NOT_PORTED',
  );
}

export async function deleteMedia(_mediaId: string): Promise<never> {
  throw new MediaApiError(
    'Media deletion is not yet exposed by the Backend API.',
    503,
    'MEDIA_DELETE_NOT_PORTED',
  );
}
