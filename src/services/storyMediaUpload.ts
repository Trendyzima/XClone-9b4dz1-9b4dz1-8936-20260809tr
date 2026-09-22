import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';

export interface StoryUploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'retrying' | 'uploaded' | 'failed';
  attempts: number;
  mediaId?: string;
  publicUrl?: string;
  error?: string;
}

interface InitResponse {
  media_id: string;
  upload_url: string;
  public_url?: string | null;
  object_key: string;
  expires_in: number;
}

interface CompleteResponse {
  id: string;
  object_key: string;
  public_url?: string | null;
  media_url?: string | null;
  media_type: string;
  mime_type: string;
  byte_size: number;
  status: string;
}

const MAX_RETRIES = 3;
const CONCURRENCY = 4; // bounded browser-side fan-out; large bytes never transit Vercel

function mediaApiUrl() {
  return '/api/media';
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication required');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function xhrPut(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Cloudflare upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading media'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

async function uploadCanonical(file: File, onProgress: (pct: number) => void): Promise<CompleteResponse> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Authentication required');
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch(`${supabaseUrl}/functions/v1/post-media-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: supabasePublishableKey },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Upload failed (${response.status})`);
  onProgress(100);
  return { id: body.media_id, object_key: body.object_key, public_url: body.public_url ?? null, media_url: body.media_url ?? body.public_url ?? null, media_type: body.media_type, mime_type: body.mime_type, byte_size: body.size_bytes, status: body.status };
}

async function uploadOne(
  item: StoryUploadItem,
  update: (patch: Partial<StoryUploadItem>) => void,
): Promise<CompleteResponse> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    update({ status: attempt === 1 ? 'uploading' : 'retrying', attempts: attempt, error: undefined });
    try {
      const ticket = await init(item.file);
      update({ mediaId: ticket.media_id });

      await xhrPut(ticket.upload_url, item.file, progress => update({ progress }));
      const finalized = await complete(ticket.media_id);

      update({
        status: 'uploaded',
        progress: 100,
        mediaId: finalized.id,
        publicUrl: finalized.public_url ?? finalized.media_url ?? ticket.public_url ?? undefined,
      });
      return finalized;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 600 * 2 ** (attempt - 1)));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Upload failed';
  update({ status: 'failed', error: message });
  throw new Error(message);
}

export async function uploadStoryMedia(
  files: File[],
  onUpdate: (index: number, patch: Partial<StoryUploadItem>) => void,
  concurrency = CONCURRENCY,
): Promise<{ assets: CompleteResponse[]; failed: number[] }> {
  const items: StoryUploadItem[] = files.map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    file,
    progress: 0,
    status: 'queued',
    attempts: 0,
  }));

  const assets: CompleteResponse[] = new Array(files.length);
  const failed: number[] = [];
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;

      const update = (patch: Partial<StoryUploadItem>) => onUpdate(index, patch);
      try {
        assets[index] = await uploadOne(items[index], update);
      } catch {
        failed.push(index);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, files.length)) }, () => worker()),
  );

  return { assets, failed };
}

export { CONCURRENCY as STORY_UPLOAD_CONCURRENCY, MAX_RETRIES as STORY_UPLOAD_MAX_RETRIES };
