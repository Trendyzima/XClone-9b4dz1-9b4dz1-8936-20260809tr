import { appwriteAuth } from '@/services/appwriteAuth';
import { backendCapabilities } from './backendClient';
import { TestagramEvent, trackTestagramEvent } from '../lib/testagram-analytics';

export const MAX_POST_BODY_LENGTH = 5000;

export type CreatePostInput = {
  body: string;
  media?: File[];
  communityId?: string | null;
};

export type CreatedPost = {
  id: string;
  author_id: string;
  body: string;
  content: string;
  media: [];
};

/**
 * Creates a text post through the native Appwrite-authenticated Backend API.
 * Media attachment and community publishing are intentionally rejected until
 * their native Neon contracts are deployed; they must never fall back to
 * Supabase REST/RPC or the retired product-media bridge.
 */
export async function createPost(input: CreatePostInput): Promise<CreatedPost> {
  const body = input.body.trim();
  if (!body) throw new Error('Write something before publishing.');
  if (body.length > MAX_POST_BODY_LENGTH) throw new Error(`Post text must be ${MAX_POST_BODY_LENGTH} characters or fewer.`);
  if (input.media?.length) {
    throw new Error('Media publishing is temporarily unavailable while the native Backend media-attachment contract is completed.');
  }
  if (input.communityId?.trim()) {
    throw new Error('Community publishing is temporarily unavailable while its native Backend post route is completed.');
  }

  const user = await appwriteAuth.getCurrentUser();
  if (!user) throw new Error('Authentication required');

  const result = await backendCapabilities.createPost({
    content: body,
    visibility: 'public',
    idempotencyKey: globalThis.crypto?.randomUUID?.(),
  });
  const postId = String(result?.post_id ?? '');
  if (!postId) throw new Error('Backend did not return the new post ID.');

  trackTestagramEvent(TestagramEvent.POST_CREATED, {
    post_id: postId,
    media_count: 0,
    has_media: false,
    community_id: null,
  });
  return { id: postId, author_id: user.$id, body, content: body, media: [] };
}
