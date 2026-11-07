/**
 * Testagram Recommendation Engine
 * Twitter-style interest-graph + engagement-decay scoring
 *
 * Architecture:
 * 1. Signal collection: likes, reposts, follows, hashtag follows, browsing history
 * 2. Candidate sourcing: interest-graph posts, social-graph posts, viral posts
 * 3. Scoring: engagement × recency-decay × interest-match × social-proof
 * 4. Deduplication + diversity rules
 */

import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { socialApi } from '@/services/socialApiClient';

// ── Types ─────────────────────────────────────────────────────────────────
export interface ScoredPost {
  post: any;
  score: number;
  reason: string;
  source: 'interest' | 'social' | 'viral' | 'following' | 'new';
}

export interface FeedSignals {
  followingIds: string[];
  mutedIds: string[];
  blockedIds: string[];
  interestTags: string[];     // hashtags user follows/interacts with
  likedPostIds: string[];     // recent 50 liked posts for topic inference
  viewedPostIds: string[];    // recently seen (for dedup)
}

// ── Constants ────────────────────────────────────────────────────────────
const ENGAGEMENT_WEIGHTS = {
  like:    2.0,
  repost:  3.0,
  reply:   1.5,
  view:    0.05,
  tip:     5.0,   // strong signal
  bookmark:4.0,
};

const RECENCY_HALF_LIFE_HOURS = 12; // score halves every 12 hours (Twitter-like)
const VERIFIED_BONUS    = 5;
const VIDEO_BONUS       = 8;
const MEDIA_BONUS       = 4;
const FOLLOWING_BONUS   = 20;  // posts from people user follows get a big boost
const INTEREST_BONUS    = 15;  // posts matching user hashtag interests
const VIRAL_THRESHOLD   = 500; // views to be considered "viral"

// ── Core scorer ──────────────────────────────────────────────────────────
export function scorePost(post: any, signals: FeedSignals): { score: number; reason: string } {
  const ageHours = (Date.now() - new Date(post.created_at).getTime()) / 3_600_000;

  // Base engagement score
  const engagementScore =
    (post.likes_count ?? 0)   * ENGAGEMENT_WEIGHTS.like   +
    (post.reposts_count ?? 0) * ENGAGEMENT_WEIGHTS.repost +
    (post.replies_count ?? 0) * ENGAGEMENT_WEIGHTS.reply  +
    (post.views_count ?? 0)   * ENGAGEMENT_WEIGHTS.view   +
    (post.tips_count ?? 0)    * ENGAGEMENT_WEIGHTS.tip;

  // Recency decay: halves every RECENCY_HALF_LIFE_HOURS
  const decayFactor = Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);

  // Type bonuses
  const typeBonus = post.is_video
    ? VIDEO_BONUS
    : (post.image_url || (post.media_urls?.length > 0))
      ? MEDIA_BONUS
      : 0;

  // Trust signals
  const verifiedBonus = post.user_profiles?.verified ? VERIFIED_BONUS : 0;
  const boostBonus    = post.is_boosted ? 50 : 0;

  // Social graph bonus
  const followingBonus = signals.followingIds.includes(post.user_id) ? FOLLOWING_BONUS : 0;

  // Interest graph bonus — check hashtags on post
  // post._hashtag_tags injected during fetch for hashtag feed
  const postTags: string[] = (post._hashtag_tags ?? []).map((t: string) => t.toLowerCase());
  const interestBonus = postTags.some(t => signals.interestTags.includes(t)) ? INTEREST_BONUS : 0;

  const total = (engagementScore * decayFactor) + typeBonus + verifiedBonus + boostBonus + followingBonus + interestBonus;

  // Reason string for transparency (Twitter "Why am I seeing this?")
  let reason = 'Trending content';
  if (followingBonus > 0) reason = 'From someone you follow';
  else if (interestBonus > 0) reason = 'Matches your interests';
  else if ((post.views_count ?? 0) >= VIRAL_THRESHOLD) reason = 'Trending now';
  else if ((post.likes_count ?? 0) > 50) reason = 'Highly liked';

  return { score: total, reason };
}

// ── Signal loader ────────────────────────────────────────────────────────
export async function loadUserSignals(_userId: string): Promise<FeedSignals> {
  return backendCapabilities.call<FeedSignals>('testagram.feed.signals', {});
}

export async function fetchCandidates(_userId: string, _signals: FeedSignals, limit = 100): Promise<{ post: any; source: ScoredPost['source'] }[]> {
  const result = await backendCapabilities.call<{ items: { post: any; source: ScoredPost['source'] }[] }>('testagram.feed.candidates', {
    limit: Math.min(200, Math.max(1, Math.floor(limit))),
  });
  return result.items;
}

export async function buildPersonalizedFeed(_userId: string, limit = 50): Promise<ScoredPost[]> {
  const result = await socialApi.getHomeFeed(Math.min(50, Math.max(1, Math.floor(limit))));
  return result.posts.map(post => ({ post, score: 0, reason: 'Ranked by Testagram Algorithm service', source: 'following' as const }));
}

export async function buildFollowingFeed(_userId: string, _followingIds: string[], _page = 0, pageSize = 20): Promise<ScoredPost[]> {
  const result = await socialApi.getHomeFeed(Math.min(50, Math.max(1, Math.floor(pageSize))));
  return result.posts.map(post => ({ post, score: 0, reason: 'Ranked by Testagram Algorithm service', source: 'following' as const }));
}

export async function updateInterestSignal(userId: string, postId: string, signal: 'like' | 'repost' | 'bookmark' | 'view', weight = 1) {
  return backendCapabilities.call('testagram.feed.interest.update', { user_id: userId, post_id: postId, signal, weight });
}
