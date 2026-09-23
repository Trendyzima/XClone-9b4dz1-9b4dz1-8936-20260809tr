import { backendCapabilities } from '@/services/backendClient';
import { supabase } from '@/lib/supabase';
import type { LikeState, RepostState } from '@/services/testagramCapabilityClient';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

// Federation and local interaction identities are deliberately disjoint: ActivityPub URIs never enter local UUID tables.
const isRemoteStatus = (postId: string) => /^https:\/\//i.test(postId);

async function remoteAction(path: string, body: Record<string, unknown>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: normalizedPath, method: 'POST', body },
  });
  // Federated interactions are best-effort: a remote server can reject an
  // otherwise valid ActivityPub interaction without making the local UI fail.
  if (error) {
    console.warn('[federation] interaction unavailable', path, error);
    return { ok: false, supported: false, status: 'unavailable', queued: false };
  }
  if (data?.error) {
    console.warn('[federation] interaction rejected', path, data.error);
    return { ok: false, supported: false, status: 'unavailable', queued: false, error: data.error };
  }
  return data;
}

export async function togglePostLike(postId: string, currentlyLiked = false): Promise<LikeState> {
  if (!postId) throw new Error('Post id is required');
  if (isRemoteStatus(postId)) {
    const data = await remoteAction(currentlyLiked ? 'unfavorite' : 'favorite', { post_id: postId });
    const delivered = data?.accepted === true || data?.status === 'pending' || data?.delivery?.status === 'delivered' || data?.delivery?.status === 'queued' || data?.delivery?.queue?.status === 'delivered' || data?.delivery?.queue?.status === 'queued';
    const nextLiked = delivered && !currentlyLiked;
    trackTestagramEvent(nextLiked ? TestagramEvent.POST_LIKED : TestagramEvent.POST_UNLIKED, { post_id: postId });
    return { is_liked: nextLiked, likes_count: Number(data?.remote?.like_count ?? data?.likes_count ?? 0) };
  }
  const response = await backendCapabilities.likePost(postId);
  trackTestagramEvent(response.state.is_liked ? TestagramEvent.POST_LIKED : TestagramEvent.POST_UNLIKED, { post_id: postId, likes_count: response.state.likes_count });
  return response.state;
}

export async function togglePostRepost(postId: string, currentlyReposted = false): Promise<RepostState> {
  if (!postId) throw new Error('Post id is required');
  if (isRemoteStatus(postId)) {
    const data = await remoteAction(currentlyReposted ? 'unboost' : 'boost', { post_id: postId });
    const delivered = data?.delivery?.status === 'delivered' || data?.delivery?.status === 'queued' || data?.delivery?.queue?.status === 'delivered' || data?.delivery?.queue?.status === 'queued' || data?.ok === true;
    const nextReposted = delivered && !currentlyReposted;
    trackTestagramEvent(nextReposted ? TestagramEvent.POST_REPOSTED : TestagramEvent.POST_UNREPOSTED, { post_id: postId });
    return { is_reposted: nextReposted, reposts_count: Number(data?.remote?.announce_count ?? data?.reposts_count ?? 0) };
  }
  const response = await backendCapabilities.repostPost(postId);
  trackTestagramEvent(response.state.is_reposted ? TestagramEvent.POST_REPOSTED : TestagramEvent.POST_UNREPOSTED, { post_id: postId, reposts_count: response.state.reposts_count });
  return response.state;
}

export async function createFederatedReply(postId: string, content: string) {
  if (!isRemoteStatus(postId)) return backendCapabilities.createReply(postId, content);
  return remoteAction('reply', { post_id: postId, content });
}

export async function setFederatedReaction(postId: string, emoji: string, active: boolean) {
  if (!isRemoteStatus(postId)) throw new Error('Federated reaction requires a remote object URI');
  return remoteAction('federated/reactions', { post_id: postId, emoji, enabled: active });
}

export async function getFederatedReactionState(postId: string): Promise<{ emoji: string | null; active: boolean }> {
  if (!isRemoteStatus(postId)) return { emoji: null, active: false };
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: '/federated/reactions', method: 'GET', params: { object_uri: postId } },
  });
  if (error) return { emoji: null, active: false };
  return { emoji: typeof data?.emoji === 'string' ? data.emoji : null, active: Boolean(data?.active) };
}

export async function getFederatedReactionStateAll(postId: string): Promise<{ emojis: string[] }> {
  if (!isRemoteStatus(postId)) return { emojis: [] };
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: '/federated/reactions', method: 'GET', params: { object_uri: postId } },
  });
  if (error) return { emojis: [] };
  return { emojis: Array.isArray(data?.emojis) ? data.emojis.filter((x: unknown): x is string => typeof x === 'string') : [] };
}

export async function getFederatedReactionCounts(postId: string): Promise<Record<string, number>> {
  if (!isRemoteStatus(postId)) return {};
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: '/federated-reaction-counts', method: 'GET', params: { object_uri: postId } },
  });
  if (error || !data?.counts) return {};
  return data.counts as Record<string, number>;
}

export type InteractionCounts = { likes: number; reposts: number; replies: number; quotes: number; views: number };

export async function getInteractionCounts(postId: string): Promise<InteractionCounts> {
  if (!postId) return { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 };
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: '/interaction-counts', method: 'GET', params: { post_id: postId } },
  });
  if (error) {
    console.warn('[engagement] interaction counts unavailable', error);
    return { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 };
  }
  return {
    likes: Math.max(0, Number(data?.likes ?? 0)),
    reposts: Math.max(0, Number(data?.reposts ?? 0)),
    replies: Math.max(0, Number(data?.replies ?? 0)),
    quotes: Math.max(0, Number(data?.quotes ?? 0)),
    views: Math.max(0, Number(data?.views ?? 0)),
  };
}

export async function recordPostView(postId: string): Promise<number> {
  if (!postId) return 0;
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: '/record-post-view', method: 'POST', body: { post_id: postId } },
  });
  if (error) throw error;
  return Math.max(0, Number(data?.views ?? 0));
}

export async function getFederatedInteractionCounts(postId: string): Promise<InteractionCounts> {
  return getInteractionCounts(postId);
}

export async function getFederatedReplies(postId: string): Promise<any[]> {
  if (!isRemoteStatus(postId)) return [];
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: 'federated-replies', method: 'GET', params: { object_uri: postId } },
  });
  if (error) {
    console.warn('[federation] replies unavailable', error);
    return [];
  }
  return Array.isArray(data?.items) ? data.items : [];
}

export async function getFederatedInteractionState(postId: string): Promise<{ is_liked: boolean; is_reposted: boolean }> {
  if (!isRemoteStatus(postId)) return { is_liked: false, is_reposted: false };
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path: 'federated-interaction-state', method: 'GET', params: { object_uri: postId } },
  });
  if (error) {
    console.warn('[federation] interaction state unavailable', error);
    return { is_liked: false, is_reposted: false };
  }
  return { is_liked: Boolean(data?.like), is_reposted: Boolean(data?.repost) };
}

// Persistence reconciliation: remote reaction writes are keyed by the canonical ActivityPub object URI.
