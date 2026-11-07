import { testagramApi } from '@/services/testagramApi';
import { appwriteAuth } from '@/services/appwriteAuth';

const freshAppwriteMode = import.meta.env.VITE_TESTAGRAM_FRESH_MODE === 'true' ||
  (import.meta.env.VITE_TESTAGRAM_AUTH_PROVIDER ?? '').trim().toLowerCase() === 'appwrite';

type SocialEnvelope<T> = {
  ok: boolean;
  data: T | null;
  error: { code?: string; message?: string } | null;
  request_id?: string;
};

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

const configuredOrigin = (import.meta.env.VITE_TESTAGRAM_API_URL ?? import.meta.env.VITE_API_URL ?? '')
  .trim()
  .replace(/\/+$/, '');
const apiBase = configuredOrigin ? `${configuredOrigin}/api/social` : '/api/social';
async function getSessionToken(): Promise<string> {
  try {
    return await appwriteAuth.createBackendJWT();
  } catch {
    throw new SocialApiError('Your Appwrite session is unavailable. Please sign in again.', 401, 'AUTH_REQUIRED');
  }
}


function assertSocialAPIAvailable(path: string, allowFreshRoute = false): void {
  if (!freshAppwriteMode || allowFreshRoute) return;
  throw new SocialApiError(
    'This feature is not yet available through the Testagram Backend API. The retired data source is disabled.',
    503,
    'FEATURE_NOT_PORTED',
  );
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<T> {
  return requestAt<T>(`${apiBase}${path}`, method, body);
}

async function requestAt<T>(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>, allowFreshRoute = false, extraHeaders: Record<string, string> = {}): Promise<T> {
  assertSocialAPIAvailable(url, allowFreshRoute);
  const token = await getSessionToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...extraHeaders,
  };
  if (body) headers['Content-Type'] = 'application/json';

  let response: Response;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 12000);
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SocialApiError('Social service timed out. Please retry.', 0, 'TIMEOUT');
    }
    throw new SocialApiError('Testagram API is unreachable. Check your connection and API URL.', 0, 'NETWORK_ERROR');
  } finally {
    globalThis.clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null) as SocialEnvelope<T> | null;
  if (!response.ok || !payload?.ok || payload.data == null) {
    throw new SocialApiError(
      payload?.error?.message || `Social request failed (${response.status}).`,
      response.status,
      payload?.error?.code || 'SOCIAL_API_ERROR',
      payload?.request_id || null,
    );
  }
  return payload.data;
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
