import { appwriteAuth } from '@/services/appwriteAuth';

type UploadReservation = {
  reservation_id: string;
  object_id: string;
  upload_url: string;
  upload_method: 'PUT';
  required_headers: Record<string, string>;
  expires_at: string;
  reserved_bytes: number;
  status: 'reserved' | 'uploaded_primary' | 'protected';
  primary_provider?: 'b2' | 'r2';
};

type APIError = { error?: { message?: string } };

export class FreshMediaError extends Error {
  readonly status: number;
  readonly idempotencyKey: string | null;
  constructor(message: string, status = 0, idempotencyKey: string | null = null) {
    super(message);
    this.name = 'FreshMediaError';
    this.status = status;
    this.idempotencyKey = idempotencyKey;
  }
}

function apiOrigin(): string {
  const raw = (import.meta.env.VITE_TESTAGRAM_FRESH_API_URL ?? '').trim();
  if (!raw) throw new FreshMediaError('The fresh Testagram API URL is not configured.');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new FreshMediaError('The fresh Testagram API URL is invalid.'); }
  const localHTTP = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !localHTTP) || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new FreshMediaError('The fresh Testagram API URL must be an HTTPS origin (HTTP only on localhost).');
  }
  return parsed.origin;
}

async function backendHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await appwriteAuth.createBackendJWT()}`,
    Accept: 'application/json',
    ...extra,
  };
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as APIError | null;
  return payload?.error?.message || `Fresh media request failed (HTTP ${response.status}).`;
}

function safeUploadType(file: File): string {
  const type = file.type.trim().toLowerCase();
  const allowed = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
    'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm',
  ]);
  if (!allowed.has(type)) throw new FreshMediaError('This media format is not supported by fresh storage.');
  return type;
}

export const freshMediaApi = {
  /**
   * Uploads directly to the provider selected and persisted by Backend for this
   * reservation, then asks Backend to verify the origin and its peer replica.
   * The server calculates SHA-256 while streaming the stored object, avoiding
   * loading large video files into browser memory for Web Crypto hashing.
   */
  async upload(file: File, idempotencyKey = crypto.randomUUID()): Promise<{ objectId: string; reservationId: string }> {
    if (!(file instanceof File) || file.size < 1) throw new FreshMediaError('Choose a non-empty media file.');
    if (!idempotencyKey.trim() || idempotencyKey.length > 128) throw new FreshMediaError('Invalid upload idempotency key.');
    const origin = apiOrigin();
    const contentType = safeUploadType(file);
    let reserveResponse: Response;
    try {
      reserveResponse = await fetch(origin + '/v1/media/uploads/reservations', {
        method: 'POST',
        headers: await backendHeaders({
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        }),
        body: JSON.stringify({ bytes: file.size, content_type: contentType }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      throw new FreshMediaError('Could not reach the fresh API. Retry with the same idempotency key.', 0, idempotencyKey);
    }
    if (!reserveResponse.ok) throw new FreshMediaError(await readError(reserveResponse), reserveResponse.status, idempotencyKey);
    const reservation = await reserveResponse.json() as UploadReservation;
    if (!reservation.reservation_id || !reservation.object_id || reservation.reserved_bytes !== file.size ||
        !['reserved', 'uploaded_primary', 'protected'].includes(reservation.status)) {
      throw new FreshMediaError('The storage service returned an invalid upload reservation.');
    }
    if (reservation.status === 'protected') {
      return { objectId: reservation.object_id, reservationId: reservation.reservation_id };
    }

    if (reservation.status === 'reserved') {
      const primaryProvider = reservation.primary_provider ?? 'b2';
      if (primaryProvider !== 'b2' && primaryProvider !== 'r2') {
        throw new FreshMediaError('The storage service selected an unsupported upload provider.');
      }
      if (!reservation.upload_url || reservation.upload_method !== 'PUT' || !reservation.required_headers?.['Content-Type']) {
        throw new FreshMediaError('The storage service returned an invalid upload URL.');
      }
      let uploadURL: URL;
      try { uploadURL = new URL(reservation.upload_url); } catch { throw new FreshMediaError('The storage service returned an invalid upload URL.'); }
      const allowedHost = primaryProvider === 'b2'
        ? uploadURL.hostname === 'backblazeb2.com' || uploadURL.hostname.endsWith('.backblazeb2.com')
        : uploadURL.hostname === 'r2.cloudflarestorage.com' || uploadURL.hostname.endsWith('.r2.cloudflarestorage.com');
      if (uploadURL.protocol !== 'https:' || uploadURL.username || uploadURL.password || uploadURL.hash || !allowedHost) {
        throw new FreshMediaError('The storage service returned an upload URL outside the selected private object-store provider.');
      }
      // Do not attach the Appwrite JWT to the object-store URL.
      let uploadResponse: Response;
      try {
        uploadResponse = await fetch(reservation.upload_url, {
          method: 'PUT',
          headers: reservation.required_headers,
          body: file,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
        });
      } catch {
        throw new FreshMediaError('The media upload failed. Retry with the same idempotency key.', 0, idempotencyKey);
      }
      if (!uploadResponse.ok) throw new FreshMediaError('The media upload failed. Retry with the same idempotency key.', uploadResponse.status, idempotencyKey);
    }

    let completeResponse: Response;
    try {
      completeResponse = await fetch(
        origin + '/v1/media/uploads/' + encodeURIComponent(reservation.reservation_id) + '/complete',
        {
          method: 'POST',
          headers: await backendHeaders(),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
        },
      );
    } catch {
      throw new FreshMediaError('The upload is saved but replica finalization could not be confirmed. Retry with the same idempotency key.', 0, idempotencyKey);
    }
    if (!completeResponse.ok) throw new FreshMediaError(await readError(completeResponse), completeResponse.status, idempotencyKey);
    const result = await completeResponse.json() as { ok?: boolean; status?: string };
    if (result.ok !== true || result.status !== 'protected') {
      throw new FreshMediaError('The media was uploaded but has not yet reached protected replica status.', 0, idempotencyKey);
    }
    return { objectId: reservation.object_id, reservationId: reservation.reservation_id };
  },

  async getPrivateDownloadURL(objectId: string): Promise<string> {
    if (!objectId.trim() || objectId.length > 128) throw new FreshMediaError('Invalid media object ID.');
    const response = await fetch(apiOrigin() + '/v1/media/' + encodeURIComponent(objectId) + '/download', {
      method: 'GET',
      headers: await backendHeaders(),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new FreshMediaError(await readError(response), response.status);
    const result = await response.json() as { url?: string; expires_in_seconds?: number; visibility?: string };
    if (!result.url || result.visibility !== 'private' || result.expires_in_seconds !== 120) {
      throw new FreshMediaError('The storage service returned an invalid private-media URL.');
    }
    let parsed: URL;
    try { parsed = new URL(result.url); } catch { throw new FreshMediaError('The storage service returned an invalid media URL.'); }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      throw new FreshMediaError('The media URL is not secure.');
    }
    return parsed.toString();
  },
};
