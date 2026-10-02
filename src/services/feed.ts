import { backendCapabilities } from '@/services/backendClient';
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

type MergedCursor = { local: string | null; fed: string | null };

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

function normalizeFederated(item: any): Post {
  const mediaUrls = normalizeMediaUrls(item);
  const remoteAccount = item.user_profiles ?? item.remote_account ?? item.account ?? item.author;
  return {
    ...item,
    id: `fed:${item.id ?? item.federation_id}`,
    content: item.content ?? item.html ?? '',
    created_at: item.created_at ?? item.published ?? new Date().toISOString(),
    author: item.author ?? remoteAccount,
    user_profiles: remoteAccount,
    image_url: item.image_url ?? (!item.is_video ? mediaUrls[0] : undefined),
    video_url: item.video_url ?? (item.is_video ? mediaUrls[0] : undefined),
    media_urls: mediaUrls,
    media_count: Number(item.media_count ?? mediaUrls.length),
    is_video: Boolean(item.is_video || item.video_url),
    origin: 'federated',
    federation_id: item.id ?? item.federation_id,
  };
}

function decodeMergedCursor(value?: string): MergedCursor {
  if (!value) return { local: null, fed: null };
  try {
    const decoded = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (decoded && typeof decoded === 'object') {
      return {
        local: typeof decoded.local === 'string' ? decoded.local : null,
        fed: typeof decoded.fed === 'string' ? decoded.fed : null,
      };
    }
  } catch {
    // Accept an older local-only cursor during the rollout.
  }
  return { local: value, fed: null };
}

function encodeMergedCursor(cursor: MergedCursor): string | undefined {
  if (!cursor.local && !cursor.fed) return undefined;
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function getMergedHomeTimeline({ limit = 20, before }: { limit?: number; before?: string } = {}) {
  const size = Math.min(Math.max(Math.floor(limit), 1), 50);
  const cursor = decodeMergedCursor(before);

  const [localResult, federatedResult] = await Promise.all([
    backendCapabilities.listPosts(size, cursor.local, 'following'),
    federation.getFederatedTimelinePage({ limit: size, before: cursor.fed ?? undefined }),
  ]);

  const localItems = Array.isArray(localResult?.items) ? localResult.items : [];
  const federatedItems = Array.isArray(federatedResult?.items) ? federatedResult.items : [];

  const localPosts = localItems.map(normalizeLocal);
  const fedPosts = federatedItems.map(normalizeFederated);

  const map = new Map<string, Post>();
  [...localPosts, ...fedPosts].forEach((post) => {
    const key = post.federation_id ?? post.id;
    if (!map.has(key) || new Date(post.created_at) > new Date(map.get(key)!.created_at)) {
      map.set(key, post);
    }
  });

  const posts = Array.from(map.values())
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, size);

  const next_cursor = encodeMergedCursor({
    local: localResult?.next_cursor ?? null,
    fed: federatedResult?.pagination?.nextCursor ?? null,
  });

  return { posts, next_cursor };
}
