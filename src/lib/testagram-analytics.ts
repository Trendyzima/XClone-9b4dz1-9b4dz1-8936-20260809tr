import { analytics } from './posthog';

export const TestagramEvent = {
  SIGNED_UP: 'testagram_signed_up',
  LOGGED_IN: 'testagram_logged_in',
  LOGGED_OUT: 'testagram_logged_out',
  PROFILE_VIEWED: 'profile_viewed',
  PROFILE_UPDATED: 'profile_updated',
  POST_CREATED: 'post_created',
  POST_VIEWED: 'post_viewed',
  POST_LIKED: 'post_liked',
  POST_UNLIKED: 'post_unliked',
  POST_SHARED: 'post_shared',
  POST_REPOSTED: 'post_reposted',
  POST_UNREPOSTED: 'post_unreposted',
  POST_DELETED: 'post_deleted',
  USER_FOLLOWED: 'user_followed',
  USER_UNFOLLOWED: 'user_unfollowed',
  SEARCH_PERFORMED: 'search_performed',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_DELETED: 'message_deleted',
  MESSAGE_REACTED: 'message_reacted',
  CALL_STARTED: 'testagram_call_started',
  CALL_JOINED: 'testagram_call_joined',
  CALL_ENDED: 'testagram_call_ended',
  NOTIFICATION_OPENED: 'notification_opened',
  NOTIFICATION_READ: 'notification_read',
  BOOKMARK_ADDED: 'bookmark_added',
  BOOKMARK_REMOVED: 'bookmark_removed',
  COMMUNITY_CREATED: 'community_created',
  COMMUNITY_JOINED: 'community_joined',
  COMMUNITY_LEFT: 'community_left',
  AD_VIEWED: 'ad_viewed',
  AD_CLICKED: 'ad_clicked',
  AD_CREATED: 'ad_created',
  AD_PAYMENT_STARTED: 'ad_payment_started',
  AD_PAYMENT_COMPLETED: 'ad_payment_completed',
  CAMPAIGN_CREATED: 'campaign_created',
  CAMPAIGN_PUBLISHED: 'campaign_published',
  WALLET_DEPOSIT_STARTED: 'wallet_deposit_started',
  WALLET_DEPOSIT_COMPLETED: 'wallet_deposit_completed',
  SEARCH_RESULT_OPENED: 'search_result_opened',
  SESSION_STARTED: 'testagram_session_started',
} as const;

export type TestagramEventName = (typeof TestagramEvent)[keyof typeof TestagramEvent];

export function trackTestagramEvent(
  event: TestagramEventName,
  properties?: Record<string, unknown>,
): void {
  analytics.track(event, {
    app: 'testagram',
    ...properties,
  });
}
