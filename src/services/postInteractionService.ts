import { backendCapabilities } from '@/services/backendClient';
import { supabase } from '@/lib/supabase';
import type { LikeState, RepostState } from '@/services/testagramCapabilityClient';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

const isRemoteStatus = (postId: string) => /^https:\/\//i.test(postId);

async function remoteAction(path: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path, method: 'POST', body },
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
    const delivered = data?.delivery?.status === 'delivered' || data?.delivery?.status === 'queued' || data?.delivery?.queue?.status === 'delivered' || data?.delivery?.queue?.status === 'queued' || data?.ok === true;
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
