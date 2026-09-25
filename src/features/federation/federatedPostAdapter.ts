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
  if (!uri) return { uri: '', username: '', displayName: '', avatar: undefined };
  const embedded = typeof actorRef === 'object' ? actorRef : null;
  let actor = embedded;
  if (!actor && /^https:\/\//i.test(uri)) {
    try { const result = await getObject(uri); actor = result?.object ?? result; } catch { /* actor enrichment is best-effort */ }
  }
  const username = String(actor?.preferredUsername ?? actor?.username ?? actor?.acct ?? '').replace(/^@/, '') || uri.split('/').filter(Boolean).pop() || '';
  const displayName = String(actor?.name ?? actor?.displayName ?? actor?.preferredUsername ?? username).trim();
  return { uri, username, displayName, avatar: firstUrl(actor?.icon) };
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
    const result = await getObject(uri);
    let collection = result?.object ?? result;
    let entries = Array.isArray(collection?.orderedItems)
      ? collection.orderedItems
      : Array.isArray(collection?.items)
        ? collection.items
        : [];
    // Many fediverse servers return a paged collection (or compact reply IDs).
    // Keep this hydration bounded so a single post cannot fan out unbounded requests.
    // Follow the first page when the collection itself contains no members, then
    // hydrate compact IDs into full ActivityPub objects before rendering them.
    if (!entries.length) {
      const first = typeof collection?.first === 'string'
        ? collection.first
        : collection?.first?.id ?? collection?.first?.url ?? '';
      if (first) {
        try {
          const firstResult = await getObject(first);
          collection = firstResult?.object ?? firstResult;
          entries = Array.isArray(collection?.orderedItems)
            ? collection.orderedItems
            : Array.isArray(collection?.items)
              ? collection.items
              : [];
        } catch {}
      }
    }
    const hydrated = await Promise.all(entries.slice(0, 50).map(async (entry: any) => {
      const id = typeof entry === 'string' ? entry : entry?.id ?? entry?.url ?? '';
      if (!id) return null;
      const hasContent = typeof entry === 'object' && Boolean(entry?.content ?? entry?.name ?? entry?.summary);
      if (hasContent && typeof entry?.attributedTo === 'object') return entry;
      try {
        const fetched = await getObject(id);
        return fetched?.object ?? fetched ?? entry;
      } catch {
        return entry;
      }
    }));
    return hydrated.filter((x: any) => x?.id);
  } catch { return []; }
}

export function federatedReplyToItem(reply: any, parentPostId: string) {
  const actorRef = reply?.attributedTo;
  const actorUri = typeof actorRef === 'string' ? actorRef : actorRef?.id ?? actorRef?.url ?? '';
  const username = String(typeof actorRef === 'object'
    ? (actorRef?.preferredUsername ?? actorRef?.username ?? actorRef?.acct ?? '')
    : '').replace(/^@/, '') || actorUri.split('/').filter(Boolean).pop() || '';
  const displayName = String(typeof actorRef === 'object'
    ? (actorRef?.name ?? actorRef?.displayName ?? actorRef?.preferredUsername ?? username)
    : username).trim();
  const avatar = firstUrl(typeof actorRef === 'object' ? actorRef?.icon : undefined);
  let domain = '';
  try { domain = actorUri ? new URL(actorUri).hostname : ''; } catch {}
  return {
    id: String(reply?.id ?? ''),
    user_id: String(actorUri || ''),
    post_id: parentPostId,
    content: String(reply?.content ?? reply?.name ?? reply?.summary ?? ''),
    created_at: String(reply?.published ?? reply?.created ?? new Date().toISOString()),
    updated_at: String(reply?.updated ?? reply?.published ?? reply?.created ?? new Date().toISOString()),
    parent_reply_id: undefined,
    profile: {
      id: actorUri,
      username,
      preferredUsername: username,
      display_name: displayName,
      name: displayName,
      avatar_url: avatar,
      actor_uri: actorUri,
      domain,
      verified: false,
    },
    remote: true,
  };
}
