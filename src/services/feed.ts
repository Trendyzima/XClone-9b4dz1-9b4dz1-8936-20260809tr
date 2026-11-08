import { backendCapabilities } from '@/services/backendClient';
import { socialApi } from '@/services/socialApiClient';
import * as federation from '@/api/federation';

export type Post = {
  id: string;
  content: string;
  created_at: string;
  author: any;
  origin: 'local' | 'federated';
  federation_id?: string;
  visibility?: string;
  [k: string]: any;
};

function normalizeMediaUrls(row: any): string[] {
  const raw = row?.media_urls ?? row?.mediaUrls ?? row?.attachments ?? [];
  const urls = Array.isArray(raw)
    ? raw.map((item: any) => typeof item === 'string' ? item : (item?.url ?? item?.media_url ?? item?.mediaUrl)).filter(Boolean)
    : [];
  if (urls.length) return Array.from(new Set(urls));
  const singular = row?.image_url ?? row?.video_url ?? row?.media_url ?? row?.mediaUrl;
  return singular ? [singular] : [];
}

function normalizeLocal(row: any): Post {
  const mediaUrls = normalizeMediaUrls(row);
  return {
    ...row,
    id: row.id,
    content: row.content ?? '',
    created_at: row.created_at,
    author: row.author ?? row.profile ?? row.user_profiles,
    user_profiles: row.user_profiles ?? row.profile ?? row.author,
    image_url: row.image_url ?? (row.is_video ? undefined : mediaUrls[0]),
    video_url: row.video_url ?? (row.is_video ? mediaUrls[0] : undefined),
    media_urls: mediaUrls,
    media_count: Number(row.media_count ?? mediaUrls.length),
    is_video: Boolean(row.is_video || row.video_url),
    origin: 'local',
  };
}

export async function getMergedHomeTimeline({ limit = 20, before }: { limit?: number; before?: string } = {}) {
  const size = Math.min(Math.max(Math.floor(limit), 1), 50);
  // XClone talks only to the canonical Backend API. Federation is composed by
  // Backend after its own authorization and is never queried from the browser.
  const result = await socialApi.getHomeFeed(size, before);
  const posts = (Array.isArray(result?.posts) ? result.posts : []).map(normalizeLocal);
  return {
    posts,
    next_cursor: result?.next_cursor ?? undefined,
    has_more: Boolean(result?.has_more),
    ranking_mode: result?.ranking_mode ?? 'chronological',
  };
}
