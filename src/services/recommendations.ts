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

import { supabase } from '@/lib/supabase';

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
export async function loadUserSignals(userId: string): Promise<FeedSignals> {
  const [
    followingRes, mutedRes, blockedRes, interestRes, likedRes, viewedRes,
  ] = await Promise.allSettled([
    supabase.from('follows').select('following_id').eq('follower_id', userId).limit(200),
    supabase.from('user_mutes').select('muted_id').eq('muter_id', userId).limit(100),
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id', userId).limit(100),
    supabase.from('user_interests')
      .select('hashtags(tag)')
      .eq('user_id', userId)
      .order('interest_score', { ascending: false })
      .limit(50),
    supabase.from('likes').select('post_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
    supabase.from('browsing_history')
      .select('post_id')
      .eq('user_id', userId)
      .eq('view_type', 'post')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const followingIds: string[] = followingRes.status === 'fulfilled'
    ? (followingRes.value.data ?? []).map((r: any) => r.following_id)
    : [];

  const mutedIds: string[] = mutedRes.status === 'fulfilled'
    ? (mutedRes.value.data ?? []).map((r: any) => r.muted_id)
    : [];

  const blockedIds: string[] = blockedRes.status === 'fulfilled'
    ? (blockedRes.value.data ?? []).map((r: any) => r.blocked_id)
    : [];

  const interestTags: string[] = interestRes.status === 'fulfilled'
    ? (interestRes.value.data ?? []).map((r: any) => r.hashtags?.tag).filter(Boolean).map((t: string) => t.toLowerCase())
    : [];

  const likedPostIds: string[] = likedRes.status === 'fulfilled'
    ? (likedRes.value.data ?? []).map((r: any) => r.post_id)
    : [];

  const viewedPostIds: string[] = viewedRes.status === 'fulfilled'
    ? (viewedRes.value.data ?? []).map((r: any) => r.post_id).filter(Boolean)
    : [];

  return { followingIds, mutedIds, blockedIds, interestTags, likedPostIds, viewedPostIds };
}

// ── Candidate sourcer ────────────────────────────────────────────────────
export async function fetchCandidates(
  userId: string,
  signals: FeedSignals,
  limit = 100,
): Promise<{ post: any; source: ScoredPost['source'] }[]> {
  const candidates: { post: any; source: ScoredPost['source'] }[] = [];
  const seenIds = new Set<string>(signals.viewedPostIds.slice(0, 50));

  // Batch 1: Chronological following feed (80%)
  if (signals.followingIds.length > 0) {
    const { data: followPosts } = await supabase
      .from('posts')
      .select('*, profiles(*)')
      .in('user_id', signals.followingIds)
      .not('user_id', 'in', `(${[...signals.mutedIds, ...signals.blockedIds].slice(0, 50).join(',') || "''"})`)
      .is('community_id', null)
      .order('created_at', { ascending: false })
      .limit(Math.round(limit * 0.8));

    for (const p of followPosts ?? []) {
      if (!seenIds.has(p.id)) {
        candidates.push({ post: p, source: 'following' });
        seenIds.add(p.id);
      }
    }
  }

  // Batch 2: Interest-graph candidates (from followed hashtags)
  if (signals.interestTags.length > 0) {
    const { data: htagRows } = await supabase
      .from('hashtags')
      .select('id')
      .in('tag', signals.interestTags.slice(0, 20));

    const tagIds = (htagRows ?? []).map((r: any) => r.id);

    if (tagIds.length > 0) {
      const { data: postHashtags } = await supabase
        .from('post_hashtags')
        .select('post_id, hashtags(tag)')
        .in('hashtag_id', tagIds)
        .limit(200);

      const interestPostIds = [...new Set((postHashtags ?? []).map((r: any) => r.post_id))];
      // esbuild guard: plain untyped object (no Record<string,T> annotation)
      const tagByPost: any = {};
      for (const ph of postHashtags ?? []) {
        if (!tagByPost[ph.post_id]) tagByPost[ph.post_id] = [];
        if ((ph as any).hashtags?.tag) tagByPost[ph.post_id].push((ph as any).hashtags.tag);
      }

      if (interestPostIds.length > 0) {
        const { data: intPosts } = await supabase
          .from('posts')
          .select('*, profiles(*)')
          .in('id', interestPostIds.slice(0, 50))
          .not('user_id', 'eq', userId)
          .is('community_id', null)
          .order('likes_count', { ascending: false });

        for (const p of intPosts ?? []) {
          if (!seenIds.has(p.id)) {
            candidates.push({
              post: { ...p, _hashtag_tags: tagByPost[p.id] ?? [] },
              source: 'interest',
            });
            seenIds.add(p.id);
          }
        }
      }
    }
  }

  // Batch 3: Viral/trending posts (2nd-degree connections + popular)
  const { data: viralPosts } = await supabase
    .from('posts')
    .select('*, profiles(*)')
    .is('community_id', null)
    .gte('views_count', VIRAL_THRESHOLD)
    .not('user_id', 'eq', userId)
    .order('views_count', { ascending: false })
    .limit(30);

  for (const p of viralPosts ?? []) {
    if (!seenIds.has(p.id) &&
        !signals.mutedIds.includes(p.user_id) &&
        !signals.blockedIds.includes(p.user_id)) {
      candidates.push({ post: p, source: 'viral' });
      seenIds.add(p.id);
    }
  }

  return candidates;
}

// ── Main feed builder ────────────────────────────────────────────────────
export async function buildPersonalizedFeed(
  userId: string,
  limit = 50,
): Promise<ScoredPost[]> {
  const signals = await loadUserSignals(userId);
  const candidates = await fetchCandidates(userId, signals, limit * 2);

  // Score all candidates
  const scored: ScoredPost[] = candidates.map(({ post, source }) => {
    const { score, reason } = scorePost(post, signals);
    return { post, score, reason, source };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Diversity rule: no more than 3 consecutive posts from same author
  const result: ScoredPost[] = [];
  // esbuild guard: plain untyped object (no Record<string,T> annotation)
  const authorCount: any = {};
  for (const item of scored) {
    const uid = item.post.user_id;
    const cnt = authorCount[uid] ?? 0;
    if (cnt >= 3) continue;
    authorCount[uid] = cnt + 1;
    result.push(item);
    if (result.length >= limit) break;
  }

  return result;
}

// ── Following feed builder (80% following + 20% viral from 2nd-degree) ──
export async function buildFollowingFeed(
  userId: string,
  followingIds: string[],
  page = 0,
  pageSize = 20,
): Promise<ScoredPost[]> {
  if (followingIds.length === 0) return [];

  const signals = await loadUserSignals(userId);
  const offset = page * pageSize;

  // Primary: chronological posts from following
  const { data: primaryPosts } = await supabase
    .from('posts')
    .select('*, profiles(*)')
    .in('user_id', followingIds)
    .not('user_id', 'in', `(${signals.mutedIds.slice(0, 50).join(',') || "''"})`)
    .is('community_id', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.round(pageSize * 0.8) - 1);

  const primary: ScoredPost[] = (primaryPosts ?? []).map(post => {
    const { score, reason } = scorePost(post, signals);
    return { post, score, reason, source: 'following' as const };
  });

  // Secondary: viral posts from 2nd-degree (followers of people you follow)
  let secondary: ScoredPost[] = [];
  if (page === 0 && followingIds.length > 0) {
    const sampleFollowing = followingIds.slice(0, 10);
    const { data: secondDegreeFollows } = await supabase
      .from('follows')
      .select('following_id')
      .in('follower_id', sampleFollowing)
      .not('following_id', 'in', `(${[userId, ...followingIds].slice(0, 50).join(',')})`)
      .limit(30);

    const secondDegreeIds = [...new Set((secondDegreeFollows ?? []).map((r: any) => r.following_id))] as string[];

    if (secondDegreeIds.length > 0) {
      const { data: viralPosts } = await supabase
        .from('posts')
        .select('*, profiles(*)')
        .in('user_id', secondDegreeIds)
        .is('community_id', null)
        .order('likes_count', { ascending: false })
        .limit(Math.round(pageSize * 0.2));

      secondary = (viralPosts ?? []).map(post => {
        const { score, reason } = scorePost(post, signals);
        return { post, score, reason: `Popular from connections`, source: 'viral' as const };
      });
    }
  }

  // Merge: 80% primary + 20% secondary, interleaved
  const merged: ScoredPost[] = [];
  let pi = 0, si = 0;
  const primaryTarget = Math.round(pageSize * 0.8);
  const secondaryTarget = pageSize - primaryTarget;

  while (merged.length < pageSize) {
    if (pi < primary.length && pi < primaryTarget) {
      merged.push(primary[pi++]);
    } else if (si < secondary.length && si < secondaryTarget) {
      merged.push(secondary[si++]);
    } else if (pi < primary.length) {
      merged.push(primary[pi++]);
    } else {
      break;
    }
  }

  return merged;
}

// ── Interest updater (called on like/repost/bookmark) ───────────────────
export async function updateInterestSignal(
  userId: string,
  postId: string,
  signal: 'like' | 'repost' | 'bookmark' | 'view',
  weight = 1,
) {
  // Fetch hashtags for this post
  const { data: phs } = await supabase
    .from('post_hashtags')
    .select('hashtag_id')
    .eq('post_id', postId)
    .limit(10);

  const tagIds = (phs ?? []).map((r: any) => r.hashtag_id);
  if (tagIds.length === 0) return;

  const signalWeight = ENGAGEMENT_WEIGHTS[signal] ?? 1;
  const delta = signalWeight * weight * 0.1; // incremental interest update

  for (const hashtag_id of tagIds) {
    await supabase.rpc('increment', { row_id: hashtag_id, increment_amount: delta }).then(() => {}).catch(() => {});
    // Upsert interest score
    const { data: existing } = await supabase
      .from('user_interests')
      .select('id, interest_score')
      .eq('user_id', userId)
      .eq('hashtag_id', hashtag_id)
      .maybeSingle();

    if (existing) {
      const newScore = Math.min(Number(existing.interest_score) + delta, 10);
      await supabase
        .from('user_interests')
        .update({ interest_score: newScore, last_interaction: new Date().toISOString() })
        .eq('id', existing.id)
        .then(() => {}).catch(() => {});
    } else {
      await supabase
        .from('user_interests')
        .insert({ user_id: userId, hashtag_id, interest_score: delta, last_interaction: new Date().toISOString() })
        .then(() => {}).catch(() => {});
    }
  }
}
