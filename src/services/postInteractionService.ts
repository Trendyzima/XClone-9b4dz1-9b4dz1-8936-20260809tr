import { backendCapabilities } from '@/services/backendClient';
import type { LikeState, RepostState } from '@/services/testagramCapabilityClient';

/**
 * Canonical local-social interaction adapter.
 *
 * This is deliberately separate from federation APIs: local likes/reposts are
 * owned by post_likes/post_reposts through the capability plane.
 */
export async function togglePostLike(postId: string): Promise<LikeState> {
  if (!postId) throw new Error('Post id is required');
  const response = await backendCapabilities.likePost(postId);
  return response.state;
}

export async function togglePostRepost(postId: string): Promise<RepostState> {
  if (!postId) throw new Error('Post id is required');
  const response = await backendCapabilities.repostPost(postId);
  return response.state;
}
