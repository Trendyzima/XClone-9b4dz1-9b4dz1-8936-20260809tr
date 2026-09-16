import { analytics } from './posthog';

export const TestagramEvent = {
  SIGNED_UP: 'testagram_signed_up',
  LOGGED_IN: 'testagram_logged_in',
  LOGGED_OUT: 'testagram_logged_out',
  PROFILE_VIEWED: 'profile_viewed',
  POST_CREATED: 'post_created',
  POST_VIEWED: 'post_viewed',
  POST_LIKED: 'post_liked',
  POST_SHARED: 'post_shared',
  POST_DELETED: 'post_deleted',
  USER_FOLLOWED: 'user_followed',
  USER_UNFOLLOWED: 'user_unfollowed',
  SEARCH_PERFORMED: 'search_performed',
  MESSAGE_SENT: 'message_sent',
  NOTIFICATION_OPENED: 'notification_opened',
  AD_VIEWED: 'ad_viewed',
  AD_CLICKED: 'ad_clicked',
  WALLET_DEPOSIT_STARTED: 'wallet_deposit_started',
  WALLET_DEPOSIT_COMPLETED: 'wallet_deposit_completed',
  CAMPAIGN_CREATED: 'campaign_created',
  CAMPAIGN_PUBLISHED: 'campaign_published',
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
