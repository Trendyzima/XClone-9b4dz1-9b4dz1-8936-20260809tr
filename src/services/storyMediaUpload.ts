import { uploadMedia, type MediaUploadResult } from '@/lib/media';

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

async function uploadCanonical(file: File, onProgress: (pct: number) => void): Promise<CompleteResponse> {
  const result: MediaUploadResult = await uploadMedia(file);
  onProgress(100);
  return {
    id: result.media_id,
    object_key: result.object_key,
    public_url: result.public_url,
    media_url: result.public_url,
    media_type: result.media_type ?? 'file',
    mime_type: result.mime_type,
    byte_size: result.size_bytes,
    status: result.status,
  };
}

async function uploadOne(
  item: StoryUploadItem,
  update: (patch: Partial<StoryUploadItem>) => void,
): Promise<CompleteResponse> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    update({ status: attempt === 1 ? 'uploading' : 'retrying', attempts: attempt, error: undefined });
    try {
      const finalized = await uploadCanonical(item.file, progress => update({ progress }));

      update({
        status: 'uploaded',
        progress: 100,
        mediaId: finalized.id,
        publicUrl: finalized.public_url ?? finalized.media_url ?? undefined,
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
