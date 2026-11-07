import { appwriteAuth } from '@/services/appwriteAuth';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
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
 * Creates the post through the central Backend API, then uploads media through
 * the verified B2/R2 media service. The browser never writes database rows.
 */
export async function createPost(input: CreatePostInput): Promise<CreatedPost> {
  const body = input.body.trim();
  if (!body && !(input.media?.length)) throw new Error('Post cannot be empty.');
  if (body.length > MAX_POST_BODY_LENGTH) throw new Error(`Post text must be ${MAX_POST_BODY_LENGTH} characters or fewer.`);

  const user = await appwriteAuth.getCurrentUser();
  if (!user) throw new Error('Authentication required');

  const files = input.media ?? [];
  // Keep all post creation on the canonical capability boundary. The former
  // direct table INSERT duplicated the write contract and was the source of
  // the canonical Backend API is the only write boundary.
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
      uploaded.push(await uploadMedia(file, post.id));
    }

    if (uploaded.length) {
      const mediaUrls = uploaded.map((media) => media.public_url).filter((url): url is string => Boolean(url));
      const first = uploaded[0];
      await backendCapabilities.call('testagram.posts.media.attach', {
        post_id: post.id,
        media: uploaded.map((item, index) => ({
          media_id: item.media_id,
          media_type: item.media_type,
          sort_order: index,
        })),
        media_count: uploaded.length,
        media_urls: mediaUrls,
        image_url: first.media_type === 'image' ? first.public_url : null,
        video_url: first.media_type === 'video' ? first.public_url : null,
        is_video: first.media_type === 'video',
      });
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
    await backendCapabilities.call('testagram.posts.delete', { post_id: post.id }).catch(() => undefined);
    throw error;
  }
}
