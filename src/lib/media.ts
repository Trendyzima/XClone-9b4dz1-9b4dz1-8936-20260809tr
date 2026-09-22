import { supabase } from './supabase';

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = new Set<string>();

mport { supabase } from './supabase';

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
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
  media_type?: 'image' | 'video' | 'audio' | 'file';
  status: 'uploaded';
  etag?: string | null;
  post_id?: string | null;
};

function validateMedia(file: File) {
  if (!file.type && !file.name) throw new Error('File type could not be determined.');
  if (file.size <= 0 || file.size > MAX_MEDIA_BYTES) throw new Error('Attachments must be 500 MiB or smaller.');
}

