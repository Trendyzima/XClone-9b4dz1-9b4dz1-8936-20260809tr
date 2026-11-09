import { testagramApiRequest, TestagramApiError } from '@/services/apiClient';
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

const configuredOrigin = (import.meta.env.VITE_TESTAGRAM_API_URL ?? '')
  .trim()
  .replace(/\/+$/, '');
const freshApiOrigin = configuredOrigin;
const freshApiFeedPath = freshApiOrigin ? `${freshApiOrigin}/api/feed/home` : '/api/feed/home';
const freshApiPublicFeedPath = freshApiOrigin ? `${freshApiOrigin}/api/feed/public` : '/api/feed/public';

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<T> {
  return requestAt<T>(`/api/social${path}`, method, body);
}

async function requestAt<T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: Record<string, unknown>,
  _allowFreshRoute = false,
  extraHeaders: Record<string, string> = {},
  allowAnonymous = false,
): Promise<T> {
  let path: string;
  try {
    const base = configuredOrigin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const parsed = new URL(url, base);
    if (parsed.origin !== new URL(base).origin) throw new Error('Cross-origin API URL rejected');
    path = parsed.pathname + parsed.search;
  } catch {
    throw new SocialApiError('Invalid Testagram API URL.', 400, 'API_URL_INVALID');
  }
  try {
    return await testagramApiRequest<T>(path, {
      method,
      body,
      headers: extraHeaders,
      anonymous: allowAnonymous,
    });
  } catch (error) {
    if (error instanceof TestagramApiError) {
      throw new SocialApiError(error.message, error.status, error.code, error.requestId);
    }
    throw error;
  }
}

export type SocialLikeState = { liked: boolean; likes_count: number; removed?: boolean };
export type SocialRepostState = { reposted: boolean; reposts_count: number; removed?: boolean };

export const socialApi = {
  getHomeFeed(limit = 20, before?: string, followingOnly = false) {
    const query = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, Math.floor(limit)))) });
    if (before) query.set('before', before);
    if (followingOnly) query.set('following_only', 'true');
    return requestAt<{ posts: any[]; next_cursor: string; has_more: boolean; ranking_mode: 'algorithm' | 'chronological' }>(
      `${freshApiFeedPath}?${query.toString()}`, 'GET', undefined, true,
    );
  },
  getPublicHomeFeed(limit = 20, before?: string) {
    const query = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, Math.floor(limit)))) });
    if (before) query.set('before', before);
    return requestAt<{ posts: any[]; next_cursor: string; has_more: boolean; ranking_mode: 'chronological' }>(
      `${freshApiPublicFeedPath}?${query.toString()}`, 'GET', undefined, true, {}, true,
    );
  },
  createPost(content: string, visibility: 'public' | 'followers' | 'private' = 'public', sensitive = false, idempotencyKey?: string) {
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID?.() ?? `post-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return requestAt<{ $id: string; author_id: string; body: string; visibility: string; status: string; created_at: string }>(
      `${freshApiOrigin}/v1/posts`, 'POST', { content, visibility, sensitive }, true, { 'Idempotency-Key': key },
    );
  },
  moderateContent(content: string) {
    return requestAt<{ overall_score: number; categories: Record<string, number>; action: 'pass' | 'flag' | 'auto_ban'; reason: string }>(
      `${freshApiOrigin}/v1/moderation/check`, 'POST', { content }, true,
    );
  },
  getFederationPreference() {
    return requestAt<{ enabled: boolean }>(`${freshApiOrigin}/api/me/federation`, 'GET', undefined, true);
  },
  setFederationPreference(enabled: boolean) {
    return requestAt<{ enabled: boolean }>(`${freshApiOrigin}/api/me/federation`, 'PUT', { enabled }, true);
  },
  getFollowState(userId: string) {
    return request<{ following: boolean; requested: boolean; status: string }>(`/follows/${encodeURIComponent(userId)}`, 'GET');
  },
  setFollow(userId: string, active: boolean) {
    return active
      ? request<{ status: string; already_following: boolean }>('/follows', 'POST', { target_user_id: userId })
      : request<{ unfollowed: boolean }>(`/follows/${encodeURIComponent(userId)}`, 'DELETE');
  },
  setBlock(userId: string, active: boolean) {
    return active
      ? request<{ blocked: boolean }>('/blocks', 'POST', { target_user_id: userId })
      : request<{ unblocked: boolean }>(`/blocks/${encodeURIComponent(userId)}`, 'DELETE');
  },
  listFollowRequests(limit = 30) {
    const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Math.floor(limit)))) });
    return request<{ items: unknown[] }>(`/follow-requests?${query.toString()}`, 'GET');
  },
  respondFollowRequest(followerId: string, action: 'accept' | 'reject') {
    return request<{ status: string; accepted: boolean }>(
      `/follow-requests/${encodeURIComponent(followerId)}/${action}`,
      'POST',
    );
  },
  getInteractionSummary(postId: string) {
    return request<{
      likes: number; reposts: number; replies: number; quotes: number; views: number; shares: number;
      bookmarks: number; reaction_total: number; reactions: Record<string, number>;
      is_liked: boolean; is_reposted: boolean; is_bookmarked: boolean; user_reactions: string[];
    }>('/posts/' + encodeURIComponent(postId) + '/interaction-summary', 'GET');
  },
  getLikeState(postId: string) {
    return request<SocialLikeState & { emoji: string }>('/posts/' + encodeURIComponent(postId) + '/reaction', 'GET');
  },
  getRepostState(postId: string) {
    return request<SocialRepostState>('/posts/' + encodeURIComponent(postId) + '/reposts', 'GET');
  },
  setLike(postId: string, active: boolean, emoji = '❤️') {
    return request<SocialLikeState>('/posts/' + encodeURIComponent(postId) + '/reaction', active ? 'POST' : 'DELETE', active ? { emoji } : undefined);
  },
  setRepost(postId: string, active: boolean, quote = '') {
    return request<SocialRepostState>(`/posts/${encodeURIComponent(postId)}/reposts`, active ? 'POST' : 'DELETE', active ? { quote } : undefined);
  },
  createReply(postId: string, content: string, parentReplyId?: string) {
    return request<{ reply_id: string; post_id: string; content: string }>(
      `/posts/${encodeURIComponent(postId)}/replies`,
      'POST',
      { content, ...(parentReplyId ? { parent_reply_id: parentReplyId } : {}) },
    );
  },
  setBookmark(postId: string, active: boolean) {
    return request<{ bookmarked: boolean }>(
      `/posts/${encodeURIComponent(postId)}/bookmarks`,
      active ? 'POST' : 'DELETE',
    );
  },
  listNotifications(limit = 30, cursor?: string) {
    const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Math.floor(limit)))) });
    if (cursor) query.set('cursor', cursor);
    return request<{ items: unknown[]; next_cursor: string }>(`/notifications?${query.toString()}`, 'GET');
  },
  markNotificationRead(notificationId: string) {
    return request<{ read: boolean }>(`/notifications/${encodeURIComponent(notificationId)}/read`, 'POST');
  },
};
