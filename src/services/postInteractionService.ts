import { backendCapabilities } from '@/services/backendClient';
import type { LikeState, RepostState } from '@/services/testagramCapabilityClient';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

/**
 * Canonical local-social interaction adapter.
 *
 * This is deliberately separate from federation APIs: local likes/reposts are
 * owned by post_likes/post_reposts through the capability plane.
 */
export async function togglePostLike(postId: string): Promise<LikeState> {
  if (!postId) throw new Error('Post id is required');
  const response = await backendCapabilities.likePost(postId);
  trackTestagramEvent(response.state.is_liked ? TestagramEvent.POST_LIKED : TestagramEvent.POST_UNLIKED, {
    post_id: postId,
    likes_count: response.state.likes_count,
  });
  return response.state;
}

export async function togglePostRepost(postId: string): Promise<RepostState> {
  if (!postId) throw new Error('Post id is required');
  const response = await backendCapabilities.repostPost(postId);
  trackTestagramEvent(response.state.is_reposted ? TestagramEvent.POST_REPOSTED : TestagramEvent.POST_UNREPOSTED, {
    post_id: postId,
    reposts_count: response.state.reposts_count,
  });
  return response.state;
}
