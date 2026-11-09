import { backendCapabilities } from '@/services/backendClient';

/**
 * Profile feature transport.
 *
 * All profile reads and writes go through the authenticated Testagram Backend
 * capability gateway. There is deliberately no browser database or legacy
 * function fallback here. Capabilities not yet implemented by Backend fail
 * closed and must be completed server-side before the feature is production
 * enabled.
 */
export type ProfilePageResult<T> = T;

export const profileApi = {
  getByUsername(username: string) {
    return backendCapabilities.call<{ profile: Record<string, any> }>('testagram.profiles.get', { username });
  },
  getById(userId: string) {
    return backendCapabilities.call<{ profile: Record<string, any> }>('testagram.profiles.get', { user_id: userId });
  },
  updateProfile(input: Record<string, unknown>) {
    return backendCapabilities.call<{ profile: Record<string, any> }>('testagram.profiles.update', input);
  },
  getStoryStatus(userId: string) {
    return backendCapabilities.call<{ has_stories: boolean }>('testagram.stories.profile_status', { user_id: userId });
  },
  getBlockMuteState(userId: string) {
    return backendCapabilities.call<{ blocked: boolean; muted: boolean }>('testagram.users.relationship_state', { user_id: userId });
  },
  setMute(userId: string, muted: boolean) {
    return backendCapabilities.call<{ muted: boolean }>('testagram.users.mute', { user_id: userId, muted });
  },
  sendPremiumGift(userId: string, amount: number, idempotencyKey: string) {
    return backendCapabilities.call<{ expires_at: string; gift_id: string }>('testagram.premium.gift', { recipient_id: userId, amount, idempotency_key: idempotencyKey });
  },
  subscribe(userId: string, tier: string, amount: number, idempotencyKey: string) {
    return backendCapabilities.call<{ subscription: Record<string, any>; transfer: Record<string, any> }>('testagram.subscriptions.create', { creator_id: userId, tier, amount, idempotency_key: idempotencyKey });
  },
  cancelSubscription(userId: string) {
    return backendCapabilities.call<{ cancelled: boolean }>('testagram.subscriptions.cancel', { creator_id: userId });
  },
  getStories(ids: string[]) {
    return backendCapabilities.call<{ items: any[] }>('testagram.stories.get_many', { story_ids: ids });
  },
  trackProfileView(userId: string) {
    return backendCapabilities.call<{ tracked: boolean }>('testagram.profile.views.track', { profile_id: userId });
  },
  getProfileViews(userId: string, days = 7) {
    return backendCapabilities.call<{ count: number }>('testagram.profile.views.count', { profile_id: userId, days });
  },
  getSubscription(userId: string) {
    return backendCapabilities.call<{ subscription: Record<string, any> | null }>('testagram.subscriptions.get', { creator_id: userId });
  },
  getTipSummary(userId: string) {
    return backendCapabilities.call<{ total_earnings: number; monthly_total: number; top_tippers: Array<{ rank: number; amount: number }> }>('testagram.creator.tips.summary', { creator_id: userId });
  },
  listTips(userId: string, limit = 50) {
    return backendCapabilities.call<{ items: any[] }>('testagram.creator.tips.list', { user_id: userId, limit });
  },
  listGifts(userId: string, limit = 50) {
    return backendCapabilities.call<{ items: any[] }>('testagram.premium.gifts.list', { user_id: userId, limit });
  },
  listPodcasts(userId: string, limit = 30) {
    return backendCapabilities.call<{ items: any[] }>('testagram.profile.podcasts', { user_id: userId, limit });
  },
  getPostImpressions(userId: string, days = 30) {
    return backendCapabilities.call<{ items: Array<{ created_at: string }> }>('testagram.profile.post_impressions', { user_id: userId, days });
  },
  listSeries(userId: string, limit = 20) {
    return backendCapabilities.call<{ items: any[] }>('testagram.profile.series', { user_id: userId, limit });
  },
  pinPost(postId: string | null) {
    return backendCapabilities.call<{ pinned_post_id: string | null }>('testagram.profiles.pin_post', { post_id: postId });
  },
  listHighlights(userId: string) {
    return backendCapabilities.call<{ items: any[] }>('testagram.profile.highlights.list', { user_id: userId });
  },
  reorderHighlights(items: Array<{ id: string; sort_order: number }>) {
    return backendCapabilities.call<{ updated: number }>('testagram.profile.highlights.reorder', { items });
  },
  listStories(userId: string, limit = 30) {
    return backendCapabilities.call<{ items: any[] }>('testagram.stories.list', { user_id: userId, limit });
  },
  createHighlight(input: { title: string; cover_url: string | null; story_ids: string[]; sort_order: number }) {
    return backendCapabilities.call<{ highlight: any }>('testagram.profile.highlights.create', input);
  },
  deleteHighlight(id: string) {
    return backendCapabilities.call<{ deleted: boolean }>('testagram.profile.highlights.delete', { highlight_id: id });
  },
  sendTip(userId: string, amount: number, note: string, idempotencyKey: string) {
    return backendCapabilities.call<{ success: boolean; tip_id: string; currency: string }>('testagram.wallet.tip', { recipient_id: userId, amount, note, idempotency_key: idempotencyKey });
  },
  getActorStatus(userId: string) {
    return backendCapabilities.call<{ has_actor: boolean }>('testagram.federation.actor_status', { user_id: userId });
  },
  listPosts(userId: string) {
    return backendCapabilities.listPosts(100, undefined, 'profile', userId);
  },
  listThreads(userId: string) {
    return backendCapabilities.call<{ items: any[] }>('testagram.profile.threads', { user_id: userId, limit: 100 });
  },
  listMedia(userId: string) {
    return backendCapabilities.call<{ items: any[] }>('testagram.profile.media', { user_id: userId, limit: 100 });
  },
  listFollowers(userId: string) {
    return backendCapabilities.call<{ items: any[] }>('testagram.profile.followers', { user_id: userId, limit: 100 });
  },
  listFollowing(userId: string) {
    return backendCapabilities.call<{ items: any[] }>('testagram.profile.following', { user_id: userId, limit: 100 });
  },
  getStats(userId: string) {
    return backendCapabilities.call<{ streak_day: number; follower_rank: number | null }>('testagram.profile.stats', { user_id: userId });
  },
  getVerification(userId: string) {
    return backendCapabilities.call<{ is_verified: boolean; tier: string | null }>('testagram.profiles.verification', { user_id: userId });
  },
  getMonetization(userId: string) {
    return backendCapabilities.call<{ total_earnings: number }>('testagram.creator.monetization', { user_id: userId });
  },
  sendSocialLinks(input: { twitter: string | null; instagram: string | null; linkedin: string | null }) {
    return backendCapabilities.call<{ updated: boolean }>('testagram.profiles.social_links.update', input);
  },
};
