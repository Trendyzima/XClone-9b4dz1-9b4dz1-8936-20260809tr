import { supabase, supabasePublishableKey } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { megalodonGatewayService } from '@/services/megalodonGateway';

async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}
function remoteInstanceFromHandle(acct: string): string | null {
  const normalized = acct.trim().replace(/^@/, ''); const parts = normalized.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return `https://${parts[1].replace(/\/$/, '')}`;
}
async function api<T = any>(path: string, method = 'GET', body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const token = await getToken();
  const cleanParams = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])) : undefined;
  const { data, error } = await supabase.functions.invoke('testagram-api', { body: { path, method, body, params: cleanParams }, headers: { apikey: supabasePublishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) { try { const status = error.context?.status ?? 500; const text = await error.context?.text(); msg = `[${status}] ${text || error.message || 'Testagram API error'}`; } catch { msg = error.message ?? 'Testagram API error'; } }
    throw new GatewayError(0, msg, path);
  }
  return data as T;
}
export class GatewayError extends Error {
  constructor(public status: number, public body: string, public path: string) { super(`Testagram API error on ${path}: ${body}`); this.name = 'GatewayError'; }
}
export function isGatewayAvailable(): boolean { return true; }
export function getGatewayUrl(): string { return 'supabase://testagram-api'; }
export interface TimelineParams { limit?: number; before?: string; after?: string; feedId?: string; }
export interface FederatedPage { items: any[]; pagination: { limit: number; hasMore: boolean; nextCursor: string | null }; }
interface RemoteSearchResult { accounts?: any[]; statuses?: any[]; hashtags?: any[]; }
export async function getHomeTimeline(params: TimelineParams = {}): Promise<any[]> { return api('/timeline/home', 'GET', undefined, params as any); }
export async function getGlobalTimeline(params: TimelineParams = {}): Promise<any[]> { return api('/timeline/global', 'GET', undefined, params as any); }
export async function getLocalTimeline(params: TimelineParams = {}): Promise<any[]> { return api('/timeline/local', 'GET', undefined, params as any); }
export async function getFederatedTimeline(params: TimelineParams = {}): Promise<any[]> { return (await getFederatedTimelinePage(params)).items; }
export async function getFederatedTimelinePage(params: TimelineParams = {}): Promise<FederatedPage> {
  const token = await getToken(); const query = new URLSearchParams(); query.set('limit', String(Math.min(Math.max(params.limit ?? 20, 1), 50))); if (params.before) query.set('before', params.before); if (params.feedId) query.set('feed_id', params.feedId);
  const { data, error } = await supabase.functions.invoke(`federated-feed?${query.toString()}`, { method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (error) { let msg = error.message; if (error instanceof FunctionsHttpError) { try { const status = error.context?.status ?? 500; const text = await error.context?.text(); msg = `[${status}] ${text || error.message || 'Federated feed error'}`; } catch { msg = error.message ?? 'Federated feed error'; } } throw new GatewayError(0, msg, '/federated-feed'); }
  return data as FederatedPage;
}
export async function getUser(acct: string): Promise<any> {
  const instance = remoteInstanceFromHandle(acct);
  if (instance) {
    const normalized = acct.trim().replace(/^@/, ''); const [username] = normalized.split('@');
    const remote = await megalodonGatewayService.search(instance, `@${username}`, 'accounts') as { result?: RemoteSearchResult };
    const account = remote.result?.accounts?.[0]; if (!account) return null;
    return {
      ...account,
      id: account.id,
      preferredUsername: account.username,
      username: account.username,
      name: account.display_name,
      display_name: account.display_name,
      summary: account.note,
      bio: account.note,
      icon: account.avatar ? { url: account.avatar } : null,
      avatar_url: account.avatar ?? null,
      header_url: account.header ?? null,
      followers: account.follower_count ?? 0,
      following: account.following_count ?? 0,
      followers_count: account.follower_count ?? 0,
      following_count: account.following_count ?? 0,
      fields: Array.isArray(account.fields) ? account.fields : [],
      emojis: Array.isArray(account.emojis) ? account.emojis : [],
      url: account.url,
      // `uri` is Mastodon's ActivityPub actor identifier; `url` is only the web profile.
      actor_url: account.uri ?? null,
      actor_uri: account.uri ?? null,
    };
  }
  return api(`/webfinger/${encodeURIComponent(acct)}`);
}
export async function webfinger(acct: string): Promise<any> { return getUser(acct); }
export async function getActor(username: string): Promise<any> {
  const instance = remoteInstanceFromHandle(username); if (instance) { const normalized = username.trim().replace(/^@/, ''); const [accountName] = normalized.split('@'); const remote = await megalodonGatewayService.search(instance, `@${accountName}`, 'accounts') as { result?: RemoteSearchResult }; return remote.result?.accounts?.[0] ?? null; }
  return api(`/users/${encodeURIComponent(username)}`);
}
export async function postStatus(payload: { content: string; mediaIds?: string[]; visibility?: 'public' | 'unlisted' | 'followers' | 'direct'; inReplyTo?: string; sensitive?: boolean; spoilerText?: string }): Promise<any> { return api('/posts', 'POST', payload); }
export async function deletePost(postId: string): Promise<void> { return api(`/posts/${encodeURIComponent(postId)}`, 'DELETE'); }
export async function follow(target: string): Promise<any> { return api('/follow', 'POST', { target }); }
export async function unfollow(target: string): Promise<any> { return api('/unfollow', 'POST', { target }); }
export async function boost(postId: string): Promise<any> { return api('/boost', 'POST', { post_id: postId }); }
export async function unboost(postId: string): Promise<any> { return api('/unboost', 'POST', { post_id: postId }); }
export async function favorite(postId: string): Promise<any> { return api('/favorite', 'POST', { post_id: postId }); }
export async function unfavorite(postId: string): Promise<any> { return api('/unfavorite', 'POST', { post_id: postId }); }
export async function resolveRemoteActor(actorUri: string): Promise<any> {
  if (!/^https?:\/\//i.test(actorUri)) throw new Error('Remote actor must be an ActivityPub URL');
  return api('/federated-actor', 'GET', undefined, { actor_uri: actorUri });
}
export async function getFederatedObject(objectUri: string): Promise<any> {
  if (!/^https:\/\//i.test(objectUri)) throw new Error('Federated object must be an ActivityPub URI');
  return api('/federated-object', 'GET', undefined, { object_uri: objectUri });
}
export async function reply(payload: { postId: string; content: string; parentReplyId?: string }): Promise<any> {
  return api('/reply', 'POST', {
    post_id: payload.postId,
    content: payload.content,
    ...(payload.parentReplyId ? { parent_reply_id: payload.parentReplyId } : {}),
  });
}
export async function getFederatedReplies(objectUri: string, options: { parentUri?: string; replyObjectUri?: string } = {}): Promise<any[]> {
  const target = options.parentUri || options.replyObjectUri || objectUri;
  if (!/^https:\/\//i.test(target)) throw new Error('Federated reply target must be an ActivityPub URI');
  const result = await api<{items?: any[]}>('/federated-replies', 'GET', undefined, {
    object_uri: objectUri,
    ...(options.parentUri ? { parent_uri: options.parentUri } : {}),
    ...(options.replyObjectUri ? { reply_object_uri: options.replyObjectUri } : {}),
  });
  return Array.isArray(result?.items) ? result.items : [];
}

export async function getNotifications(params: TimelineParams = {}): Promise<any[]> { return api('/notifications', 'GET', undefined, params as any); }
export async function clearNotifications(): Promise<void> { return api('/notifications', 'DELETE'); }
export async function search(q: string, type: 'users' | 'posts' | 'hashtags' | 'instances' = 'users'): Promise<any[]> {
  const match = q.trim().replace(/^@/, '').match(/^([^@\s]+)@([^@\s]+)$/);
  if (match && (type === 'users' || type === 'instances')) { const remote = await megalodonGatewayService.search(`https://${match[2]}`, `@${match[1]}`, 'accounts') as { result?: RemoteSearchResult }; return remote.result?.accounts ?? []; }
  return api('/search', 'GET', undefined, { q, type });
}
export async function getFollowers(acct: string, params: TimelineParams = {}): Promise<any> { return api(`/users/${encodeURIComponent(acct)}/followers`, 'GET', undefined, params as any); }

export interface FederatedDiscoveryResult { users: any[]; posts: any[]; hashtags: any[]; communities: any[]; items: any[]; next_cursor?: string | null; }

/** Unified federated discovery contract used by the standalone Discover surface. */
export async function searchFederatedDiscovery(q: string, limit = 20, cursor?: string, mode: 'search' | 'suggest' = 'search', kind: 'all' | 'people' | 'posts' | 'hashtags' | 'mentions' | 'media' | 'conversations' | 'instances' = 'all'): Promise<FederatedDiscoveryResult> {
  const token = await getToken();
  const { data, error } = await supabase.functions.invoke('search-discovery', {
    method: 'POST', body: { q, limit: Math.min(Math.max(limit, 1), 50), cursor, mode, kind },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (error) throw error;
  if (!data?.ok) throw new GatewayError(0, data?.error?.message ?? 'Federated discovery failed', '/search-discovery');
  return data.data ?? { users: [], posts: [], hashtags: [], communities: [], items: [], next_cursor: null };
}
export async function getFollowing(acct: string, params: TimelineParams = {}): Promise<any> { return api(`/users/${encodeURIComponent(acct)}/following`, 'GET', undefined, params as any); }
export async function getInstance(): Promise<any> { const remote = await megalodonGatewayService.getInstance('https://mastodon.social'); return remote.instance; }
export async function getHealth(): Promise<any> { return megalodonGatewayService.detect('https://mastodon.social'); }
export async function pollFediverseInbox(userId: string): Promise<any[]> { try { const res = await getNotifications({ limit: 50 }); return Array.isArray(res) ? res : []; } catch { try { const { data } = await supabase.from('activitypub_inbox').select('*').eq('local_user_id', userId).order('created_at', { ascending: false }).limit(50); return data ?? []; } catch { return []; } } }
/** @deprecated Use the named exports above. */
export async function gwRelay<T = any>(path: string, method = 'GET', body?: any, params?: Record<string, any>): Promise<T> { return api<T>(path, method, body, params); }

export async function quoteStatus(postId: string, content: string): Promise<any> {
  if (!/^https:\/\//i.test(postId)) throw new Error('Quote target is not a remote ActivityPub object');
  return api('/quote', 'POST', { post_id: postId, content });
}
export async function flagStatus(postId: string, category: string): Promise<any> {
  if (!/^https:\/\//i.test(postId)) throw new Error('Flag target is not a remote ActivityPub object');
  return api('/flag', 'POST', { post_id: postId, category });
}

export async function bookmarkRemote(postId: string): Promise<any> { if (!/^https:\/\//i.test(postId)) throw new Error('Bookmark target must be a remote ActivityPub object'); return api('/bookmark','POST',{post_id:postId}); }
export async function unbookmarkRemote(postId: string): Promise<any> { if (!/^https:\/\//i.test(postId)) throw new Error('Bookmark target must be a remote ActivityPub object'); return api('/unbookmark','POST',{post_id:postId}); }
export async function remoteBookmarkState(postId: string): Promise<boolean> { if (!/^https:\/\//i.test(postId)) return false; const r=await api<{bookmarked:boolean}>('/bookmark-state','GET',undefined,{post_id:postId}); return Boolean(r?.bookmarked); }

export async function getFederatedDiscoveryFeed(params: { limit?: number; surface?: string; cursor?: string } = {}): Promise<{ items: any[]; nextCursor?: string | null }> {
  const token = await getToken();
  const query = new URLSearchParams({ limit: String(Math.min(Math.max(params.limit ?? 6, 1), 12)), surface: params.surface ?? 'home', ...(params.cursor ? { cursor: params.cursor } : {}) });
  const { data, error } = await supabase.functions.invoke(`federated-discovery-feed?${query.toString()}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (error) throw new GatewayError(0, error.message ?? 'Federated discovery feed error', '/federated-discovery-feed');
  return data as { items: any[]; nextCursor?: string | null };
}
