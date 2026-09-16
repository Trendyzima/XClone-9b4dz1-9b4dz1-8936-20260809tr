import { supabase } from '../lib/supabase';
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
 * Creates the post text in Supabase first, then streams each binary directly
 * to Cloudflare R2. The R2 metadata is linked back to post_media in Supabase.
 */
export async function createPost(input: CreatePostInput): Promise<CreatedPost> {
  const body = input.body.trim();
  if (!body && !(input.media?.length)) throw new Error('Post cannot be empty.');
  if (body.length > MAX_POST_BODY_LENGTH) throw new Error(`Post text must be ${MAX_POST_BODY_LENGTH} characters or fewer.`);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Authentication required');

  const files = input.media ?? [];
  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      author_id: user.id,
      user_id: user.id,
      body,
      content: body,
      community_id: input.communityId ?? null,
      media_count: 0,
      media_urls: [],
    })
    .select('id,author_id,body,content')
    .single();

  if (postError || !post) throw postError ?? new Error('Unable to create post');

  const uploaded: MediaUploadResult[] = [];
  try {
    for (const file of files) {
      uploaded.push(await uploadMedia(file, post.id));
    }

    if (uploaded.length) {
      const mediaUrls = uploaded.map((media) => media.public_url).filter((url): url is string => Boolean(url));
      const first = uploaded[0];
      const { error: updateError } = await supabase
        .from('posts')
        .update({
          media_count: uploaded.length,
          media_urls: mediaUrls,
          media_url: first.public_url,
          media_type: first.media_type,
          image_url: first.media_type === 'image' ? first.public_url : null,
          video_url: first.media_type === 'video' ? first.public_url : null,
          is_video: first.media_type === 'video',
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id)
        .eq('author_id', user.id);
      if (updateError) throw updateError;
    }

    const result = { ...post, media: uploaded };
    trackTestagramEvent(TestagramEvent.POST_CREATED, {
      post_id: post.id,
      media_count: uploaded.length,
      has_media: uploaded.length > 0,
      community_id: input.communityId ?? null,
    });
    return result;
  } catch (error) {
    await Promise.allSettled(uploaded.map((media) => deleteMedia(media.media_id)));
    await supabase.from('posts').delete().eq('id', post.id).eq('author_id', user.id);
    throw error;
  }
}
