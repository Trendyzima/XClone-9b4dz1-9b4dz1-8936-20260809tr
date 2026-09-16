export type CapabilityAccess = "public" | "authenticated";

export type CapabilityDefinition = {
  name: string;
  version: 1;
  access: CapabilityAccess;
  readonly: boolean;
  description: string;
};

/** Explicit capability registry for function-side contracts and tooling. */
export const CAPABILITIES = [
  { name: "testagram.capabilities.list", version: 1, access: "public", readonly: true, description: "List capabilities available to the caller." },
  { name: "testagram.health.read", version: 1, access: "public", readonly: true, description: "Read service-plane health." },
  { name: "testagram.posts.list", version: 1, access: "authenticated", readonly: true, description: "Read visible Testagram posts." },
  { name: "testagram.posts.create", version: 1, access: "authenticated", readonly: false, description: "Create a native Testagram post." },
  { name: "testagram.search.posts", version: 1, access: "authenticated", readonly: true, description: "Search visible posts." },
  { name: "testagram.search.users", version: 1, access: "authenticated", readonly: true, description: "Search visible profiles." },
  { name: "testagram.search.hashtags", version: 1, access: "authenticated", readonly: true, description: "Search visible hashtags." },
  { name: "testagram.search.communities", version: 1, access: "authenticated", readonly: true, description: "Search visible communities." },
  { name: "testagram.recommendations.generate", version: 1, access: "authenticated", readonly: false, description: "Generate the authenticated user's ranked recommendations." },
  { name: "testagram.notifications.rank", version: 1, access: "authenticated", readonly: true, description: "Read ranked notifications for the authenticated user." },
  { name: "testagram.notifications.list", version: 1, access: "authenticated", readonly: true, description: "List the authenticated user's canonical notifications." },
  { name: "testagram.notifications.unread_count", version: 1, access: "authenticated", readonly: true, description: "Read the authenticated user's unread notification count." },
  { name: "testagram.notifications.mark_read", version: 1, access: "authenticated", readonly: false, description: "Mark one canonical notification as read." },
  { name: "testagram.notifications.mark_all_read", version: 1, access: "authenticated", readonly: false, description: "Mark all canonical notifications as read." },
  { name: "testagram.notifications.preferences", version: 1, access: "authenticated", readonly: true, description: "Read canonical notification preferences." },
  { name: "testagram.notifications.preference_upsert", version: 1, access: "authenticated", readonly: false, description: "Update one canonical notification preference." },
  { name: "testagram.notifications.dismiss", version: 1, access: "authenticated", readonly: false, description: "Archive one canonical notification." },
  { name: "testagram.notifications.subscribe", version: 1, access: "authenticated", readonly: true, description: "Return the canonical realtime notification subscription contract." },

  { name: "testagram.lists.list", version: 1, access: "authenticated", readonly: true, description: "List the authenticated user's accessible lists." },
  { name: "testagram.lists.create", version: 1, access: "authenticated", readonly: false, description: "Create a native Testagram list." },
  { name: "testagram.lists.member.add", version: 1, access: "authenticated", readonly: false, description: "Add a user to a list owned by the caller." },
  { name: "testagram.lists.member.remove", version: 1, access: "authenticated", readonly: false, description: "Remove a user from a list owned by the caller." },
  { name: "testagram.lists.timeline", version: 1, access: "authenticated", readonly: true, description: "Read a native list timeline." },

  { name: "testagram.bookmarks.list", version: 1, access: "authenticated", readonly: true, description: "List the caller's bookmarks." },
  { name: "testagram.bookmarks.add", version: 1, access: "authenticated", readonly: false, description: "Bookmark a post for the caller." },
  { name: "testagram.bookmarks.remove", version: 1, access: "authenticated", readonly: false, description: "Remove a bookmark for the caller." },
  { name: "testagram.bookmarks.folders.list", version: 1, access: "authenticated", readonly: true, description: "List the caller's bookmark folders." },
  { name: "testagram.bookmarks.folders.create", version: 1, access: "authenticated", readonly: false, description: "Create a bookmark folder owned by the caller." },

  { name: "testagram.trends.list", version: 1, access: "authenticated", readonly: true, description: "Read current native Testagram trends." },
  { name: "testagram.follows.set", version: 1, access: "authenticated", readonly: false, description: "Set the caller's follow state for a user." },
  { name: "testagram.follows.state", version: 1, access: "authenticated", readonly: true, description: "Read the caller's follow state for a user." },
  { name: "testagram.posts.like", version: 1, access: "authenticated", readonly: false, description: "Toggle a native post like for the caller." },
  { name: "testagram.posts.repost", version: 1, access: "authenticated", readonly: false, description: "Toggle a native post repost for the caller." },

  { name: "testagram.media.list", version: 1, access: "authenticated", readonly: true, description: "Read media assets owned by the caller." },
  { name: "testagram.media.attach", version: 1, access: "authenticated", readonly: false, description: "Attach an owned media asset to an owned post." },

  { name: "testagram.communities.list", version: 1, access: "authenticated", readonly: true, description: "List accessible communities." },
  { name: "testagram.communities.create", version: 1, access: "authenticated", readonly: false, description: "Create a native Testagram community." },
  { name: "testagram.communities.join", version: 1, access: "authenticated", readonly: false, description: "Join a community as the caller." },
  { name: "testagram.communities.leave", version: 1, access: "authenticated", readonly: false, description: "Leave a community as the caller." },

  { name: "testagram.federation.status", version: 1, access: "authenticated", readonly: true, description: "Read the caller's federation outbox status." },
  { name: "testagram.wallet.read", version: 1, access: "authenticated", readonly: true, description: "Read the caller's wallet and transaction history." },
] as const satisfies readonly CapabilityDefinition[];

export type CapabilityName = (typeof CAPABILITIES)[number]["name"];

export function getCapability(name: string): CapabilityDefinition | undefined {
  return CAPABILITIES.find((capability) => capability.name === name);
}
