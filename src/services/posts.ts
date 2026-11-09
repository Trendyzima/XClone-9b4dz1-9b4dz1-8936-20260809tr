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
 * Publishes through the canonical Backend API.
 *
 * The current public post route supports text posts, then owner-checked media
 * attachment. Community posts have a dedicated route accepting verified media
 * IDs, so those objects are uploaded before the community post is created.
 * The browser never writes relational records directly.
 */
export async function createPost(input: CreatePostInput): Promise<CreatedPost> {
  const body = input.body.trim();
  const files = input.media ?? [];
  const communityId = input.communityId?.trim() || null;
  if (!body && files.length === 0) throw new Error('Post cannot be empty.');
  if (body.length > MAX_POST_BODY_LENGTH) throw new Error(`Post text must be ${MAX_POST_BODY_LENGTH} characters or fewer.`);

  const user = await appwriteAuth.getCurrentUser();
  if (!user) throw new Error('Authentication required');

  const uploaded: MediaUploadResult[] = [];
  let postId = '';

  try {
    if (communityId) {
      // Community creation accepts media IDs in its own authenticated API
      // contract. Upload first, then atomically create the community post.
      for (const file of files) uploaded.push(await uploadMedia(file));
      const result = await backendCapabilities.createCommunityPost(communityId, {
        text: body,
        media_ids: uploaded.map((media) => media.media_id),
      });
      postId = String(result?.id ?? '');
      if (!postId) throw new Error('Backend did not return the community post ID.');
    } else {
      // The current /v1/posts route supports text-only creation. Media is
      // attached only after upload completion via the owner-checked API.
      const result = await backendCapabilities.createPost({
        content: body,
        visibility: 'public',
        idempotencyKey: globalThis.crypto?.randomUUID?.(),
      });
      postId = String(result?.post_id ?? '');
      if (!postId) throw new Error('Backend did not return the new post ID.');
      for (const file of files) uploaded.push(await uploadMedia(file, postId));
    }

    const result: CreatedPost = {
      id: postId,
      author_id: user.$id,
      body,
      content: body,
      media: uploaded,
    };
    trackTestagramEvent(TestagramEvent.POST_CREATED, {
      post_id: postId,
      media_count: uploaded.length,
      has_media: uploaded.length > 0,
      community_id: communityId,
    });
    return result;
  } catch (error) {
    // Only unattached uploads are safe to delete here. Attached media belongs
    // to the created post and must not be deleted if a later step fails.
    await Promise.allSettled(uploaded.filter((media) => !media.post_id).map((media) => deleteMedia(media.media_id)));
    throw error;
  }
}
