import { backendCapabilities } from '@/services/backendClient';
import { togglePostLike } from '@/services/postInteractionService';
import { socialApi } from '@/services/socialApiClient';

export type LikeItem = { id: string; user_id: string; post_id: string; created_at: string; profile: any };
export async function getLikeState(postId: string) {
  const state = await socialApi.getLikeState(postId);
  return { is_liked: state.liked, likes_count: state.likes_count };
}
export async function toggleLike(postId: string, currentlyLiked = false) {
  return togglePostLike(postId, currentlyLiked);
}
export async function listLikes(postId: string, limit = 50): Promise<LikeItem[]> {
  const result = await backendCapabilities.call<{ items: LikeItem[] }>('testagram.posts.likes.list', {
    post_id: postId,
    limit: Math.min(100, Math.max(1, Math.floor(limit))),
  });
  return Array.isArray(result.items) ? result.items : [];
}
export async function listProfileLikes(userId: string, limit = 50, offset = 0): Promise<any[]> {
  const result = await backendCapabilities.call<{ items: any[] }>('testagram.profile.likes.list', {
    user_id: userId,
    limit: Math.min(100, Math.max(1, Math.floor(limit))),
    offset: Math.max(0, Math.floor(offset)),
  });
  return Array.isArray(result.items) ? result.items : [];
}
