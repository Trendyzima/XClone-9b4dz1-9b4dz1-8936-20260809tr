import { socialApi } from '@/services/socialApiClient';
import * as federationApi from '@/api/federation';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';
import type { LikeState, RepostState } from '@/services/testagramCapabilityClient';

const isRemoteStatus = (postId: string) => /^https:\/\//i.test(postId);

export async function togglePostLike(postId: string, currentlyLiked = false): Promise<LikeState> {
  if (!postId) throw new Error('Post id is required');
  if (isRemoteStatus(postId)) {
    const result = await (currentlyLiked ? federationApi.unfavorite(postId) : federationApi.favorite(postId));
    const liked = !currentlyLiked && (result?.accepted === true || result?.ok === true || result?.status === 'queued');
    trackTestagramEvent(liked ? TestagramEvent.POST_LIKED : TestagramEvent.POST_UNLIKED, { post_id: postId });
    return { is_liked: liked, likes_count: Number(result?.likes_count ?? result?.remote?.like_count ?? 0) };
  }
  const result = await socialApi.setLike(postId, !currentlyLiked);
  trackTestagramEvent(result.liked ? TestagramEvent.POST_LIKED : TestagramEvent.POST_UNLIKED, { post_id: postId, likes_count: result.likes_count });
  return { is_liked: result.liked, likes_count: result.likes_count };
}

export async function togglePostRepost(postId: string, currentlyReposted = false): Promise<RepostState> {
  if (!postId) throw new Error('Post id is required');
  if (isRemoteStatus(postId)) {
    const result = await (currentlyReposted ? federationApi.unboost(postId) : federationApi.boost(postId));
    const reposted = !currentlyReposted && (result?.accepted === true || result?.ok === true || result?.status === 'queued');
    trackTestagramEvent(reposted ? TestagramEvent.POST_REPOSTED : TestagramEvent.POST_UNREPOSTED, { post_id: postId });
    return { is_reposted: reposted, reposts_count: Number(result?.reposts_count ?? result?.remote?.announce_count ?? 0) };
  }
  const result = await socialApi.setRepost(postId, !currentlyReposted);
  trackTestagramEvent(result.reposted ? TestagramEvent.POST_REPOSTED : TestagramEvent.POST_UNREPOSTED, { post_id: postId, reposts_count: result.reposts_count });
  return { is_reposted: result.reposted, reposts_count: result.reposts_count };
}

export async function createFederatedReply(postId: string, content: string) {
  return isRemoteStatus(postId)
    ? federationApi.reply({ postId, content })
    : socialApi.createReply(postId, content);
}

export async function setFederatedReaction(postId: string, emoji: string, active: boolean) {
  if (!isRemoteStatus(postId)) throw new Error('Federated reaction requires a remote object URI');
  return federationApi.setReaction(postId, emoji, active);
}

export async function getFederatedReactionState(postId: string): Promise<{ emoji: string | null; active: boolean }> {
  if (!isRemoteStatus(postId)) return { emoji: null, active: false };
  const result = await federationApi.getReactionState(postId);
  return { emoji: typeof result?.emoji === 'string' ? result.emoji : null, active: Boolean(result?.active) };
}

export async function getFederatedReactionStateAll(postId: string): Promise<{ emojis: string[] }> {
  if (!isRemoteStatus(postId)) return { emojis: [] };
  const result = await federationApi.getReactionState(postId);
  return { emojis: Array.isArray(result?.emojis) ? result.emojis.filter((value): value is string => typeof value === 'string') : [] };
}

export async function getFederatedReactionCounts(postId: string): Promise<Record<string, number>> {
  if (!isRemoteStatus(postId)) return {};
  return federationApi.getReactionCounts(postId);
}

export type InteractionCounts = {
  likes: number; reposts: number; replies: number; quotes: number; views: number; shares: number;
  bookmarks: number; reaction_total: number; reactions: Record<string, number>; is_liked: boolean;
  is_reposted: boolean; is_bookmarked: boolean; user_reactions: string[];
};

const emptyCounts = (): InteractionCounts => ({
  likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0, shares: 0, bookmarks: 0,
  reaction_total: 0, reactions: {}, is_liked: false, is_reposted: false,
  is_bookmarked: false, user_reactions: [],
});

export async function getInteractionCounts(postId: string): Promise<InteractionCounts> {
  if (!postId) return emptyCounts();
  if (isRemoteStatus(postId)) {
    const value = await federationApi.getInteractionCounts(postId);
    return { ...emptyCounts(), ...value, reactions: value?.reactions ?? {}, user_reactions: value?.user_reactions ?? [] };
  }
  const value = await socialApi.getInteractionSummary(postId);
  return {
    ...emptyCounts(),
    ...value,
    likes: Number(value.likes ?? 0), reposts: Number(value.reposts ?? 0), replies: Number(value.replies ?? 0),
    quotes: Number(value.quotes ?? 0), views: Number(value.views ?? 0), shares: Number(value.shares ?? 0),
    bookmarks: Number(value.bookmarks ?? 0), reaction_total: Number(value.reaction_total ?? 0),
    reactions: value.reactions ?? {}, user_reactions: value.user_reactions ?? [],
  };
}

export async function recordPostShare(postId: string): Promise<number> {
  if (!postId) return 0;
  if (isRemoteStatus(postId)) {
    const result = await federationApi.recordShare(postId);
    return Math.max(0, Number(result?.shares ?? 0));
  }
  throw new Error('Post share counting is not yet exposed by the Backend API.');
}

export async function recordPostView(postId: string): Promise<number> {
  if (!postId) return 0;
  if (isRemoteStatus(postId)) {
    const result = await federationApi.recordView(postId);
    return Math.max(0, Number(result?.views ?? 0));
  }
  throw new Error('Post view counting is not yet exposed by the Backend API.');
}

export async function getFederatedInteractionCounts(postId: string): Promise<InteractionCounts> {
  return getInteractionCounts(postId);
}

export async function getFederatedReplies(postId: string): Promise<any[]> {
  if (!isRemoteStatus(postId)) return [];
  return federationApi.getFederatedReplies(postId);
}

export async function getFederatedInteractionState(postId: string): Promise<{ is_liked: boolean; is_reposted: boolean }> {
  if (!isRemoteStatus(postId)) return { is_liked: false, is_reposted: false };
  const state = await federationApi.getInteractionState(postId);
  return { is_liked: Boolean(state.like), is_reposted: Boolean(state.repost) };
}
