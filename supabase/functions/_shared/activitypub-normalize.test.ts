import { followersOwnerUri, normalizeAttachment, normalizeVisibility } from "./activitypub-normalize.ts";

const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

Deno.test("followers collection URI resolves to its actor URI", () => {\n  if (followersOwnerUri("https://example.test/users/alice/followers") !== "https://example.test/users/alice") throw new Error("followers owner was not resolved");\n  if (followersOwnerUri("https://example.test/users/alice/followers?page=2") !== null) throw new Error("query-bearing collection URI should not be trusted");\n});\n\nDeno.test("visibility: Public string in to is public", () => {
  if (normalizeVisibility(null, [PUBLIC], []) !== "public") throw new Error("expected public");
});

Deno.test("visibility: Public Link object in to is public", () => {
  if (normalizeVisibility(null, [{ id: PUBLIC, type: "Collection" }], []) !== "public") throw new Error("object-form Public recipient was not recognized");
});

Deno.test("visibility: JSON-LD @id recipient references are recognized", () => {
  if (normalizeVisibility(null, [{ "@id": PUBLIC }], []) !== "public") throw new Error("JSON-LD @id recipient was not recognized");
});

Deno.test("visibility: Public in cc is unlisted", () => {
  if (normalizeVisibility(null, ["https://example.test/users/alice/followers"], [PUBLIC]) !== "unlisted") throw new Error("expected unlisted");
});

Deno.test("visibility: object-form followers recipient is followers-only", () => {
  if (normalizeVisibility(null, [{ id: "https://example.test/users/alice/followers" }], []) !== "followers") throw new Error("object-form followers recipient was not recognized");
});

Deno.test("visibility: direct recipients stay direct", () => {
  if (normalizeVisibility(null, ["https://example.test/users/bob"], []) !== "direct") throw new Error("expected direct");
});

Deno.test("visibility: explicit visibility wins", () => {
  if (normalizeVisibility("unlisted", [PUBLIC], []) !== "unlisted") throw new Error("explicit visibility should be preserved");
});

Deno.test("attachment: URL Link object is normalized", () => {
  const attachment = normalizeAttachment({ type: "Document", mediaType: "image/jpeg", url: { type: "Link", href: "https://cdn.example.test/photo.jpg", mediaType: "image/jpeg" } });
  if (attachment.url !== "https://cdn.example.test/photo.jpg") throw new Error("Link href was lost");
  if (attachment.type !== "image/jpeg") throw new Error("mediaType was lost");
});

Deno.test("attachment: array-valued URLs choose first usable link", () => {
  const attachment = normalizeAttachment({ url: [{ type: "Link" }, { type: "Link", href: "https://cdn.example.test/video.mp4" }] });
  if (attachment.url !== "https://cdn.example.test/video.mp4") throw new Error("URL array was not normalized");
});

Deno.test("attachment: remote and preview aliases are accepted", () => {
  if (normalizeAttachment({ remote_url: "https://cdn.example.test/a.png" }).url !== "https://cdn.example.test/a.png") throw new Error("remote_url alias was lost");
  if (normalizeAttachment({ preview_remote_url: "https://cdn.example.test/p.png" }).url !== "https://cdn.example.test/p.png") throw new Error("preview_remote_url alias was lost");
});