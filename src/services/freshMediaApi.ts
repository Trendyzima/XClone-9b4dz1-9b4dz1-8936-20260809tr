import { uploadMedia, getPrivateMediaDownloadUrl } from '@/lib/media';

/**
 * Compatibility facade for older media call sites. All reservation, upload
 * verification, replica finalization and private-download requests now share
 * the canonical media implementation and versioned Backend transport.
 */
export const freshMediaApi = {
  async upload(file: File, idempotencyKey = globalThis.crypto.randomUUID()): Promise<{ objectId: string; reservationId: string }> {
    const result = await uploadMedia(file, null, idempotencyKey, 'post_media');
    if (!result.reservation_id) throw new Error('Backend did not return the media reservation ID.');
    return { objectId: result.media_id, reservationId: result.reservation_id };
  },

  getPrivateDownloadURL(objectId: string): Promise<string> {
    return getPrivateMediaDownloadUrl(objectId);
  },
};
