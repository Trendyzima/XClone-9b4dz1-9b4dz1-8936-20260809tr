import { supabase } from '@/lib/supabase';

type MediaInit = {
  media_id: string;
  object_key: string;
  upload_url: string;
  public_url: string | null;
  expires_in: number;
};

type MediaCompleted = {
  id: string;
  storage_key: string;
  post_id: string | null;
  byte_size: number;
  mime_type: string;
  media_type: 'image' | 'video' | 'audio' | 'file';
  status: string;
  media_url: string | null;
  etag?: string | null;
  object_key: string;
  size_bytes: number;
  public_url: string | null;
};

async function mediaRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Please sign in again');
  const response = await fetch('/api/media', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Media request failed (${response.status})`);
  return payload as T;
}

export const MAX_TESTAGRAM_MEDIA_BYTES = 20 * 1024 * 1024;

export async function uploadTestagramMedia(file: File, postId?: string | null, threadId?: string | null): Promise<MediaCompleted> {
  if (file.size <= 0 || file.size > MAX_TESTAGRAM_MEDIA_BYTES) throw new Error('Each attachment must be 20 MiB or smaller');
  const init = await mediaRequest<MediaInit>({
    action: 'init',
    name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    ...(postId ? { post_id: postId } : {}),
    ...(threadId ? { thread_id: threadId } : {}),
  });

  const upload = await fetch(init.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!upload.ok) throw new Error(`R2 upload failed (${upload.status})`);

  return mediaRequest<MediaCompleted>({
    action: 'complete',
    media_id: init.media_id,
  });
}

export async function deleteTestagramMedia(mediaId: string): Promise<void> {
  await mediaRequest({ action: 'delete', media_id: mediaId });
}
