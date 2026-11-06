import { supabase } from '@/lib/supabase';
import { appwriteAuth } from '@/services/appwriteAuth';

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
  const provider = (import.meta.env.VITE_TESTAGRAM_AUTH_PROVIDER ?? 'supabase').trim().toLowerCase();
  if (provider === 'appwrite') {
    // Explicit provider selection: never fall back to a Supabase token when the
    // backend is configured to trust Appwrite. The Go API resolves this JWT to
    // the canonical UUID through the verified identity-link table.
    try {
      return await appwriteAuth.createBackendJWT();
    } catch {
      throw new SocialApiError('Your Appwrite session is unavailable. Please sign in again.', 401, 'AUTH_REQUIRED');
    }
  }
  if (provider !== 'supabase') {
    throw new SocialApiError('Unsupported Testagram authentication provider.', 503, 'AUTH_PROVIDER_UNSUPPORTED');
  }
  let token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) token = (await supabase.auth.refreshSession()).data.session?.access_token;
  if (!token) throw new SocialApiError('Please sign in again to continue.', 401, 'AUTH_REQUIRED');
  return token;
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: Record<string, unknown>): Promise<T> {
  const token = await getSessionToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (body) headers['Content-Type'] = 'application/json';

  let response: Response;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 12000);
  try {
    response = await fetch(`${apiBase}${path}`, {
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
    throw new SocialApiError('Social service is unreachable. Check your connection and API URL.', 0, 'NETWORK_ERROR');
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
  setLike(postId: string, active: boolean, emoji = '❤️') {
    return request<SocialLikeState>(`/posts/${encodeURIComponent(postId)}/reaction`, active ? 'POST' : 'DELETE', active ? { emoji } : undefined);
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
