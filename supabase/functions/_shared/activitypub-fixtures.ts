/** Representative payloads used by conformance tests and parser regression checks. */
export const mastodonCreateNote = {
  id: "https://mastodon.example/6f/activity",
  type: "Create",
  actor: "https://mastodon.example/users/alice",
  published: "2026-01-01T00:00:00Z",
  to: ["https://www.w3.org/ns/activitystreams#Public"],
  cc: ["https://mastodon.example/users/alice/followers"],
  object: {
    id: "https://mastodon.example/users/alice/statuses/6f",
    type: "Note",
    attributedTo: "https://mastodon.example/users/alice",
    content: "hello <p>fediverse</p>",
    published: "2026-01-01T00:00:00Z",
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: ["https://mastodon.example/users/alice/followers"],
    attachment: [],
  },
};

export const pixelfedImageNote = {
  type: "Create",
  actor: { id: "https://pixelfed.example/users/photo" },
  object: {
    id: "https://pixelfed.example/p/abc",
    type: "Note",
    attributedTo: "https://pixelfed.example/users/photo",
    name: "sunset",
    content: "<p>Sunset</p>",
    attachment: [{ type: "Image", url: "https://cdn.example/sunset.jpg", mediaType: "image/jpeg", name: "sunset" }],
    tag: [{ type: "Hashtag", name: "#sunset", href: "https://pixelfed.example/tags/sunset" }],
  },
};

export const misskeyQuoteNote = {
  type: "Create",
  actor: "https://misskey.example/users/abc",
  object: {
    id: "https://misskey.example/notes/xyz",
    type: "Note",
    content: "quoted post",
    _misskey_quote: "https://misskey.example/notes/original",
    fileIds: ["file-1"],
  },
};

export const akkomaEmojiReaction = {
  type: "Like",
  actor: "https://akkoma.example/users/bob",
  object: "https://testagram.example/objects/post-1",
  content: ":blobcat:",
};

export const lemmyCommunityCreate = {
  type: "Create",
  actor: "https://lemmy.example/c/community",
  object: {
    type: "Page",
    id: "https://lemmy.example/post/1",
    attributedTo: "https://lemmy.example/c/community",
    content: "community post",
  },
};

export const peertubeVideoCreate = {
  type: "Create",
  actor: "https://video.example/accounts/channel",
  object: {
    type: "Video",
    id: "https://video.example/videos/watch/1",
    attributedTo: "https://video.example/accounts/channel",
    name: "demo video",
    attachment: [{ type: "Video", mediaType: "video/mp4", url: "https://video.example/files/demo.mp4" }],
  },
};

export const compatibilityFixtures = [
  mastodonCreateNote,
  pixelfedImageNote,
  misskeyQuoteNote,
  akkomaEmojiReaction,
  lemmyCommunityCreate,
  peertubeVideoCreate,
] as const;
