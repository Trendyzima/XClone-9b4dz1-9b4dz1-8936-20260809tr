/**
 * Canonical capability catalog consumed by native clients, UI adapters and tests.
 * This mirrors supabase/functions/_shared/capabilities.ts; it deliberately does
 * not introduce dynamic routing. It also prevents the federation/wallet naming
 * drift that previously existed in client documentation.
 */
export const TESTAGRAM_CAPABILITY_NAMES = [
  "testagram.capabilities.list",
  "testagram.health.read",
  "testagram.posts.list",
  "testagram.posts.create",
  "testagram.replies.create",
  "testagram.replies.list",
  "testagram.posts.repost.state",
  "testagram.posts.like.state",
  "testagram.posts.schedule",,
  "testagram.search.posts",
  "testagram.search.users",
  "testagram.recommendations.generate",
  "testagram.notifications.rank",
  "testagram.notifications.list",
  "testagram.notifications.unread_count",
  "testagram.notifications.mark_read",
  "testagram.notifications.mark_all_read",
  "testagram.notifications.preferences",
  "testagram.notifications.preference_upsert",
  "testagram.notifications.dismiss",
  "testagram.notifications.subscribe",
  "testagram.notifications.unsubscribe",
  "testagram.notifications.push.config",
  "testagram.notifications.test_push",
  "testagram.notifications.realtime_contract",
  "testagram.lists.list",
  "testagram.lists.create",
  "testagram.lists.member.add",
  "testagram.lists.member.remove",
  "testagram.lists.timeline",
  "testagram.bookmarks.list",
  "testagram.bookmarks.add",
  "testagram.bookmarks.remove",
  "testagram.bookmarks.folders.list",
  "testagram.bookmarks.folders.create",
  "testagram.trends.list",
  "testagram.follows.set",
  "testagram.follows.state",
  "testagram.posts.like",
  "testagram.posts.repost",
  "testagram.media.list",
  "testagram.media.attach",
  "testagram.communities.list",
  "testagram.communities.create",
  "testagram.communities.join",
  "testagram.communities.leave",
  "testagram.federation.status",
  "testagram.search.hashtags",
  "testagram.search.communities",
  "testagram.conversations.list",
  "testagram.conversations.create",
  "testagram.messages.list",
  "testagram.messages.send",
  "testagram.messages.send_encrypted",
  "testagram.messages.edit_encrypted",
  "testagram.messages.delete",
  "testagram.messages.attach",
  "testagram.messages.mark_read",
  "testagram.messages.react",
  "testagram.calls.create",
  "testagram.calls.join",
  "testagram.calls.end",
  "testagram.calls.token",
  "testagram.presence.read",
  "testagram.presence.set",
  "testagram.profile.timeline",
  "testagram.wallet.read",
] as const;

export type TestagramCapabilityName = (typeof TESTAGRAM_CAPABILITY_NAMES)[number];

export function isTestagramCapabilityName(value: string): value is TestagramCapabilityName {
  return (TESTAGRAM_CAPABILITY_NAMES as readonly string[]).includes(value);
}

/**
 * OpenGSC/RankMySEO-inspired operational grouping: local reads, social writes,
 * discovery, and account-bound services. These are labels for UI/telemetry only;
 * authorization remains in the gateway and database.
 */
export const TESTAGRAM_CAPABILITY_GROUPS = {
  discovery: ["testagram.search.posts", "testagram.search.users", "testagram.trends.list", "testagram.recommendations.generate"],
  social: ["testagram.follows.set", "testagram.follows.state", "testagram.posts.like", "testagram.posts.repost", "testagram.posts.create"],
  workspace: ["testagram.lists.list", "testagram.lists.create", "testagram.lists.member.add", "testagram.lists.member.remove", "testagram.lists.timeline", "testagram.bookmarks.list", "testagram.bookmarks.add", "testagram.bookmarks.remove", "testagram.bookmarks.folders.list", "testagram.bookmarks.folders.create"],
  media: ["testagram.media.list", "testagram.media.attach"],
  communities: ["testagram.communities.list", "testagram.communities.create", "testagram.communities.join", "testagram.communities.leave"],
  account: ["testagram.federation.status", "testagram.wallet.read"],
  operations: ["testagram.capabilities.list", "testagram.health.read", "testagram.notifications.rank"],
} as const;
