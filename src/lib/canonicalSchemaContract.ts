/**
 * Canonical frontend persistence contract.
 *
 * public.profiles is the writable identity source of truth.
 * public.user_profiles is a compatibility VIEW and must not be written to.
 * Notifications use recipient_id / actor_id / kind / post_id.
 * Post reactions use public.post_likes.
 * Profile follower totals use profiles.follower_count.
 */
export const canonicalSchemaContract = Object.freeze({
  profileTable: 'profiles',
  legacyProfileView: 'user_profiles',
  notificationRecipientColumn: 'recipient_id',
  notificationActorColumn: 'actor_id',
  notificationKindColumn: 'kind',
  postLikesTable: 'post_likes',
  profileFollowerCountColumn: 'follower_count',
} as const);
