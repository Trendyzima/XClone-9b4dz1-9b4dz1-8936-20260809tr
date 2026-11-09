import { appwriteAuth } from '@/services/appwriteAuth';
import { backendCapabilities } from './backendClient';
import { deleteMedia, uploadMedia, type MediaUploadResult } from '../lib/media';
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
  media: MediaUploadResult[];
};

/**
 * Creates posts through the canonical Testagram Backend API.
 * Appwrite supplies the signed-in identity; media.ts uploads and attaches
 * media through the Backend media API. No browser database client is used.
 */
export async function createPost(input: CreatePostInput): Promise<CreatedPost> {
  const body = input.body.trim();
  if (!body && !(input.media?.length)) throw new Error('Post cannot be empty.');
  if (body.length > MAX_POST_BODY_LENGTH) throw new Error(`Post text must be ${MAX_POST_BODY_LENGTH} characters or fewer.`);

  const user = await appwriteAuth.getCurrentUser();
  if (!user) throw new Error('Authentication required');

  const files = input.media ?? [];
  const postResult = await backendCapabilities.createPost({
    content: body,
    communityId: input.communityId ?? undefined,
  });
  const postId = String(postResult?.post_id ?? '');
  if (!postId) throw new Error('Post was created but the backend did not return its post ID.');

  const post = { id: postId, author_id: user.$id, body, content: body };
  const uploaded: MediaUploadResult[] = [];

  try {
    for (const file of files) {
      // uploadMedia performs the owner-checked Backend attachment operation
      // when a post ID is supplied; do not write media metadata from the client.
      uploaded.push(await uploadMedia(file, post.id));
    }

    const result = { ...post, media: uploaded } as CreatedPost;
    trackTestagramEvent(TestagramEvent.POST_CREATED, {
      post_id: post.id,
      media_count: uploaded.length,
      has_media: uploaded.length > 0,
      community_id: input.communityId ?? null,
    });
    return result;
  } catch (error) {
    await Promise.allSettled(uploaded.map((media) => deleteMedia(media.media_id)));
    // Post deletion is intentionally not attempted here: the current canonical
    // public API does not expose a verified owner-scoped delete-post route.
    throw error;
  }
}
