import { testagramApi } from '@/services/testagramApi';
import { TestagramApiError } from '@/services/testagramApiClient';

export class SocialApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, status: number, code = 'SOCIAL_API_ERROR', requestId: string | null = null) {
    super(message);
    this.name = 'SocialApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function capabilityRequest<T>(capability: string, input: Record<string, unknown>): Promise<T> {
  try {
    return await testagramApi.request<T>('/v1/capabilities', {
      method: 'POST',
      body: { capability, input },
    });
  } catch (error) {
    if (error instanceof TestagramApiError) {
      throw new SocialApiError(error.message, error.status, error.code, error.requestId);
    }
    throw new SocialApiError(error instanceof Error ? error.message : 'Social request failed.', 0, 'SOCIAL_API_ERROR');
  }
}

export type SocialLikeState = { liked: boolean; likes_count: number; removed?: boolean };
export type SocialRepostState = { reposted: boolean; reposts_count: number; removed?: boolean };

export const socialApi = {
  getHomeFeed(limit = 20, before?: string) {
    return testagramApi.request<{ posts: any[]; next_cursor: string | null; has_more: boolean; ranking_mode: 'algorithm' | 'chronological' }>(
      '/v1/feed/home',
      { method: 'GET', query: { limit: Math.min(50, Math.max(1, Math.floor(limit))), before } },
    );
  },
  async createPost(content: string, visibility: 'public' | 'followers' | 'private' = 'public', sensitive = false, idempotencyKey?: string) {
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID?.();
    if (!key) throw new SocialApiError('A stable idempotency key is required to publish.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    const post = await testagramApi.request<{ id?: string; $id?: string; author_id: string; body: string; visibility: string; status: string; created_at: string }>(
      '/v1/posts', { method: 'POST', body: { content, visibility, sensitive }, idempotencyKey: key },
    );
    const id = post.$id ?? post.id;
    if (!id) throw new SocialApiError('Backend returned a post without an identifier.', 502, 'INVALID_POST_RESPONSE');
    return { ...post, id, $id: id };
  },
  moderateContent(content: string) {
    return testagramApi.request<{ overall_score: number; categories: Record<string, number>; action: 'pass' | 'flag' | 'auto_ban'; reason: string }>(
      '/v1/moderation/check', { method: 'POST', body: { content } },
    );
  },
  getFederationPreference() {
    return testagramApi.request<{ enabled: boolean }>('/v1/me/federation', { method: 'GET' });
  },
  setFederationPreference(enabled: boolean) {
    return testagramApi.request<{ enabled: boolean }>('/v1/me/federation', { method: 'PUT', body: { enabled } });
  },
  getFollowState(userId: string) {
    return capabilityRequest<{ following: boolean; requested: boolean; status: string }>('testagram.follows.state', { target_user_id: userId });
  },
  setFollow(userId: string, active: boolean) {
    return active
      ? capabilityRequest<{ status: string; already_following: boolean }>('testagram.follows.create', { target_user_id: userId })
      : capabilityRequest<{ unfollowed: boolean }>('testagram.follows.delete', { target_user_id: userId });
  },
  setBlock(userId: string, active: boolean) {
    return active
      ? capabilityRequest<{ blocked: boolean }>('testagram.blocks.create', { target_user_id: userId })
      : capabilityRequest<{ unblocked: boolean }>('testagram.blocks.delete', { target_user_id: userId });
  },
  listFollowRequests(limit = 30) {
    return capabilityRequest<{ items: unknown[] }>('testagram.follow_requests.list', { limit: Math.min(100, Math.max(1, Math.floor(limit))) });
  },
  respondFollowRequest(followerId: string, action: 'accept' | 'reject') {
    return capabilityRequest<{ status: string; accepted: boolean }>('testagram.follow_requests.respond', { follower_id: followerId, action });
  },
  getInteractionSummary(postId: string) {
    return capabilityRequest<{
      likes: number; reposts: number; replies: number; quotes: number; views: number; shares: number;
      bookmarks: number; reaction_total: number; reactions: Record<string, number>;
      is_liked: boolean; is_reposted: boolean; is_bookmarked: boolean; user_reactions: string[];
    }>('testagram.posts.interaction_summary', { post_id: postId });
  },
  getLikeState(postId: string) {
    return capabilityRequest<SocialLikeState & { emoji: string }>('testagram.posts.like.state', { post_id: postId });
  },
  getRepostState(postId: string) {
    return capabilityRequest<SocialRepostState>('testagram.posts.repost.state', { post_id: postId });
  },
  setLike(postId: string, active: boolean, emoji = '❤️') {
    return active
      ? capabilityRequest<SocialLikeState>('testagram.posts.like', { post_id: postId, emoji })
      : capabilityRequest<SocialLikeState>('testagram.posts.unlike', { post_id: postId });
  },
  setRepost(postId: string, active: boolean, quote = '') {
    return active
      ? capabilityRequest<SocialRepostState>('testagram.posts.repost', { post_id: postId, quote })
      : capabilityRequest<SocialRepostState>('testagram.posts.unrepost', { post_id: postId });
  },
  createReply(postId: string, content: string, parentReplyId?: string) {
    return capabilityRequest<{ reply_id: string; post_id: string; content: string }>('testagram.replies.create', {
      post_id: postId, content, ...(parentReplyId ? { parent_reply_id: parentReplyId } : {}),
    });
  },
  setBookmark(postId: string, active: boolean) {
    return capabilityRequest<{ bookmarked: boolean }>('testagram.bookmarks.set', { post_id: postId, bookmarked: active });
  },
  listNotifications(limit = 30, cursor?: string) {
    return capabilityRequest<{ items: unknown[]; next_cursor: string }>('testagram.notifications.list', { limit: Math.min(100, Math.max(1, Math.floor(limit))), ...(cursor ? { cursor } : {}) });
  },
  markNotificationRead(notificationId: string) {
    return capabilityRequest<{ read: boolean }>('testagram.notifications.mark_read', { notification_id: notificationId });
  },
};
