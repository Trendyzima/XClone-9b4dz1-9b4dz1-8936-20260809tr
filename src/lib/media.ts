import { supabase } from './supabase';

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
]);

export type MediaUploadResult = {
  media_id: string;
  object_key: string;
  public_url: string | null;
  size_bytes: number;
  mime_type: string;
  media_type?: 'image' | 'video';
  status: 'uploaded';
  etag?: string | null;
};

function validateMedia(file: File) {
  if (!ALLOWED_MEDIA_TYPES.has(file.type.toLowerCase())) {
    throw new Error('Unsupported media type. Use a supported image or video format.');
  }
  if (file.size <= 0 || file.size > MAX_MEDIA_BYTES) {
    throw new Error('Images and videos must be 20 MiB or smaller.');
  }
}

async function mediaFunction(action: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required');

  const { data, error } = await supabase.functions.invoke('r2-media', {
    body: { action, ...body },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data;
}

/**
 * Upload media directly from the browser to Cloudflare R2.
 * Supabase stores only the media metadata; the binary never passes through Supabase.
 */
export async function uploadMedia(file: File, postId?: string | null): Promise<MediaUploadResult> {
  validateMedia(file);

  const initialized = await mediaFunction('init', {
    name: file.name,
    mime_type: file.type.toLowerCase(),
    size_bytes: file.size,
    post_id: postId ?? null,
  });

  const response = await fetch(String(initialized.upload_url), {
    method: 'PUT',
    headers: { 'Content-Type': file.type.toLowerCase() },
    body: file,
  });

  if (!response.ok) {
    await mediaFunction('delete', { media_id: initialized.media_id }).catch(() => undefined);
    throw new Error(`Cloudflare media upload failed (${response.status}).`);
  }

  return mediaFunction('complete', { media_id: initialized.media_id });
}

export async function deleteMedia(mediaId: string) {
  return mediaFunction('delete', { media_id: mediaId });
}
