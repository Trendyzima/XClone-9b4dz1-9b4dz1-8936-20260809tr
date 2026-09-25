import type { Post } from '@/types/app-types';

function firstUrl(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as any;
    return typeof v.url === 'string' ? v.url : typeof v.href === 'string' ? v.href : null;
  }
  return null;
}
export function extractFederatedMedia(object: any) {
  const attachments = Array.isArray(object?.attachment) ? object.attachment : [];
  const mediaUrls = attachments.map(firstUrl).filter((u): u is string => !!u);
  const image = mediaUrls.find(u => /image|\.(png|jpe?g|webp|gif)(\?|$)/i.test(u)) ?? null;
  const video = mediaUrls.find(u => /video|\.(mp4|webm|mov)(\?|$)/i.test(u)) ?? null;
  return { mediaUrls, image, video, isVideo: !!video };
}
export async function resolveFederatedActor(actorRef: any, getObject: (uri: string) => Promise<any>) {
  const uri = typeof actorRef === 'string' ? actorRef : actorRef?.id ?? actorRef?.url ?? '';
  if (!uri) return { uri: '', username: 'Fediverse user', displayName: 'Fediverse user', avatar: undefined };
  const embedded = typeof actorRef === 'object' ? actorRef : null;
  let actor = embedded;
  if (!actor && /^https:\/\//i.test(uri)) {
    try { const result = await getObject(uri); actor = result?.object ?? result; } catch { /* actor enrichment is best-effort */ }
  }
  const username = actor?.preferredUsername ?? actor?.name ?? uri.split('/').filter(Boolean).pop() ?? 'Fediverse user';
  return { uri, username, displayName: actor?.name ?? username, avatar: firstUrl(actor?.icon) };
}
export async function federatedObjectToPost(object: any, getObject: (uri: string) => Promise<any>): Promise<Post> {
  if (!object?.id) throw new Error('Remote ActivityPub object not found');
  const actor = await resolveFederatedActor(object.attributedTo, getObject);
  const media = extractFederatedMedia(object);
  const published = object.published ?? object.created ?? new Date().toISOString();
  return {
    id: object.id, content: object.content ?? object.name ?? object.summary ?? '', created_at: published,
    updated_at: object.updated ?? published, user_id: actor.uri, author_id: actor.uri,
    user_profiles: {
      id: actor.uri, username: actor.username, email: '', display_name: actor.displayName,
      avatar_url: actor.avatar, verified: false, follower_count: 0, following_count: 0, created_at: published,
    },
    likes_count: Number(object.likes?.totalItems ?? 0), reposts_count: Number(object.shares?.totalItems ?? 0),
    replies_count: Number(object.replies?.totalItems ?? 0), views_count: 0,
    media_urls: media.mediaUrls, image_url: media.image, video_url: media.video, is_video: media.isVideo,
    is_federated: true, federation_id: object.id,
  } as Post;
}
export async function resolveFederatedReplies(repliesRef: any, getObject: (uri: string) => Promise<any>) {
  const uri = typeof repliesRef === 'string' ? repliesRef : repliesRef?.id ?? repliesRef?.url ?? '';
  if (!uri) return [];
  try {
    const result = await getObject(uri); const collection = result?.object ?? result;
    const entries = Array.isArray(collection?.orderedItems) ? collection.orderedItems : Array.isArray(collection?.items) ? collection.items : [];
    return entries.map((entry: any) => typeof entry === 'string' ? { id: entry } : entry).filter((x: any) => x?.id);
  } catch { return []; }
}
