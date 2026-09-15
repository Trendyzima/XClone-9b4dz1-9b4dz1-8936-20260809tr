import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';

// Canonical Testagram backend API. Federation remains implemented by the
// existing Supabase federation services behind this stable contract.
async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function api<T = any>(
  path: string,
  method = 'GET',
  body?: unknown,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const token = await getToken();
  const cleanParams = params
    ? Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      )
    : undefined;

  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path, method, body, params: cleanParams },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const status = error.context?.status ?? 500;
        const text = await error.context?.text();
        msg = `[${status}] ${text || error.message || 'Testagram API error'}`;
      } catch {
        msg = error.message ?? 'Testagram API error';
      }
    }
    throw new GatewayError(0, msg, path);
  }

  return data as T;
}

export class GatewayError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`Testagram API error on ${path}: ${body}`);
    this.name = 'GatewayError';
  }
}

export function isGatewayAvailable(): boolean {
  return true;
}

export function getGatewayUrl(): string {
  return 'supabase://testagram-api';
}

export interface TimelineParams {
  limit?: number;
  before?: string;
  after?: string;
}

export async function getHomeTimeline(params: TimelineParams = {}): Promise<any[]> {
  return api('/timeline/home', 'GET', undefined, params as any);
}

export async function getGlobalTimeline(params: TimelineParams = {}): Promise<any[]> {
  return api('/timeline/global', 'GET', undefined, params as any);
}

export async function getLocalTimeline(params: TimelineParams = {}): Promise<any[]> {
  return api('/timeline/local', 'GET', undefined, params as any);
}

export async function getFederatedTimeline(params: TimelineParams = {}): Promise<any[]> {
  return api('/timeline/federated', 'GET', undefined, params as any);
}

export async function getUser(acct: string): Promise<any> {
  return api(`/webfinger/${encodeURIComponent(acct)}`);
}

export async function webfinger(acct: string): Promise<any> {
  return api(`/webfinger/${encodeURIComponent(acct)}`);
}

export async function getActor(username: string): Promise<any> {
  return api(`/users/${encodeURIComponent(username)}`);
}

export async function postStatus(payload: {
  content: string;
  mediaIds?: string[];
  visibility?: 'public' | 'unlisted' | 'followers' | 'direct';
  inReplyTo?: string;
  sensitive?: boolean;
  spoilerText?: string;
}): Promise<any> {
  return api('/posts', 'POST', payload);
}

export async function deletePost(postId: string): Promise<void> {
  return api(`/posts/${encodeURIComponent(postId)}`, 'DELETE');
}

export async function follow(target: string): Promise<any> {
  return api('/follow', 'POST', { target });
}

export async function unfollow(target: string): Promise<any> {
  return api('/unfollow', 'POST', { target });
}

export async function boost(postId: string): Promise<any> {
  return api('/boost', 'POST', { post_id: postId });
}

export async function unboost(postId: string): Promise<any> {
  return api('/unboost', 'POST', { post_id: postId });
}

export async function favorite(postId: string): Promise<any> {
  return api('/favorite', 'POST', { post_id: postId });
}

export async function unfavorite(postId: string): Promise<any> {
  return api('/unfavorite', 'POST', { post_id: postId });
}

export async function reply(payload: { postId: string; content: string }): Promise<any> {
  return api('/reply', 'POST', { post_id: payload.postId, content: payload.content });
}

export async function getNotifications(params: TimelineParams = {}): Promise<any[]> {
  return api('/notifications', 'GET', undefined, params as any);
}

export async function clearNotifications(): Promise<void> {
  return api('/notifications', 'DELETE');
}

export async function search(
  q: string,
  type: 'users' | 'posts' | 'hashtags' | 'instances' = 'users',
): Promise<any[]> {
  return api('/search', 'GET', undefined, { q, type });
}

export async function getFollowers(acct: string, params: TimelineParams = {}): Promise<any> {
  return api(`/users/${encodeURIComponent(acct)}/followers`, 'GET', undefined, params as any);
}

export async function getFollowing(acct: string, params: TimelineParams = {}): Promise<any> {
  return api(`/users/${encodeURIComponent(acct)}/following`, 'GET', undefined, params as any);
}

export async function getInstance(): Promise<any> {
  return api('/health');
}

export async function getHealth(): Promise<any> {
  return api('/health');
}

export async function pollFediverseInbox(userId: string): Promise<any[]> {
  try {
    const res = await getNotifications({ limit: 50 });
    return Array.isArray(res) ? res : [];
  } catch {
    try {
      const { data } = await supabase
        .from('activitypub_inbox')
        .select('*')
        .eq('local_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      return data ?? [];
    } catch {
      return [];
    }
  }
}

/** @deprecated Use the named exports above. */
export async function gwRelay<T = any>(
  path: string,
  method = 'GET',
  body?: any,
  params?: Record<string, any>,
): Promise<T> {
  return api<T>(path, method, body, params);
}
