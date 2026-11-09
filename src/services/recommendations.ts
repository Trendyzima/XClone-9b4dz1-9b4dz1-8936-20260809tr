/**
 * Compatibility adapter for legacy recommendation imports.
 *
 * Ranking, candidate retrieval and user-signal storage are Backend/Algorithm
 * responsibilities. XClone must preserve the order returned by Backend and
 * must never query social tables or score posts in the browser.
 */
import { SocialApiError, socialApi } from '@/services/socialApiClient';

export interface ScoredPost {
  post: any;
  /** Kept for old UI consumers; the authoritative rank lives in Backend. */
  score: number;
  reason: string;
  source: 'interest' | 'social' | 'viral' | 'following' | 'new';
}

export interface FeedSignals {
  followingIds: string[];
  mutedIds: string[];
  blockedIds: string[];
  interestTags: string[];
  likedPostIds: string[];
  viewedPostIds: string[];
}

function movedToBackend(feature: string): SocialApiError {
  return new SocialApiError(
    `${feature} is no longer calculated or stored in XClone. The Backend/Algorithm API must provide this operation.`,
    503,
    'FEATURE_MOVED_TO_BACKEND',
  );
}

/**
 * @deprecated Do not rank in the client. The Backend owns ranking and returns
 * posts in their authoritative order. This neutral result exists only to keep
 * older display-only callers from reintroducing client-side scoring.
 */
export function scorePost(_post: any, _signals: FeedSignals): { score: number; reason: string } {
  return { score: 0, reason: 'Ranked by Testagram Algorithm' };
}

/** @deprecated User signals are private Backend data; browser-side reads are forbidden. */
export async function loadUserSignals(_userId: string): Promise<FeedSignals> {
  throw movedToBackend('User recommendation signals');
}

/** @deprecated Candidate retrieval and visibility filtering belong to Backend. */
export async function fetchCandidates(
  _userId: string,
  _signals: FeedSignals,
  _limit = 100,
): Promise<{ post: any; source: ScoredPost['source'] }[]> {
  throw movedToBackend('Feed candidate retrieval');
}

/**
 * Uses the central Backend feed. Do not sort the returned posts: their order
 * is the result of Backend authorization followed by Algorithm ranking.
 */
export async function buildPersonalizedFeed(
  _userId: string,
  limit = 50,
): Promise<ScoredPost[]> {
  const page = await socialApi.getHomeFeed(Math.min(50, Math.max(1, Math.floor(limit))));
  return page.posts.map((post) => ({
    post,
    score: 0,
    reason: 'Ranked by Testagram Algorithm',
    source: 'new',
  }));
}

/** Following-only pagination needs its own Backend endpoint; never emulate it with browser database queries. */
export async function buildFollowingFeed(
  _userId: string,
  _followingIds: string[],
  _page = 0,
  _pageSize = 20,
): Promise<ScoredPost[]> {
  throw movedToBackend('Following-only feed');
}

/** Interest updates must be recorded by Backend from authenticated interaction events. */
export async function updateInterestSignal(
  _userId: string,
  _postId: string,
  _signal: 'like' | 'repost' | 'bookmark' | 'view',
  _weight = 1,
): Promise<never> {
  throw movedToBackend('Interest-signal updates');
}
