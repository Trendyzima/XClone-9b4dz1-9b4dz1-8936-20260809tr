import { assertEquals, assert } from "jsr:@std/assert";
import { compatibilityFixtures } from "./activitypub-fixtures.ts";
import { actorId, idOf, normalizeAttachment, normalizeNote, normalizeVisibility, typeOf } from "./activitypub-conformance.ts";

Deno.test("compatibility fixtures expose normalized actors and activity types", () => {
  for (const activity of compatibilityFixtures) {
    assert(typeof activity.type === "string");
    assertEquals(typeof actorId(activity as Record<string, unknown>), "string");
  }
});

Deno.test("ActivityStreams object references normalize from strings and objects", () => {
  assertEquals(idOf("https://example.test/object"), "https://example.test/object");
  assertEquals(idOf({ id: "https://example.test/object" }), "https://example.test/object");
  assertEquals(typeOf({ type: "Note" }), "Note");
});

Deno.test("visibility defaults conservatively and recognizes public/followers", () => {
  assertEquals(normalizeVisibility(undefined, ["https://www.w3.org/ns/activitystreams#Public"], []), "public");
  assertEquals(normalizeVisibility(undefined, [], ["https://example.test/users/a/followers"]), "followers");
  assertEquals(normalizeVisibility(undefined, [], []), "direct");
});

Deno.test("attachments and notes tolerate federation dialects", () => {
  const note = normalizeNote({
    id: "https://example.test/note",
    type: "Note",
    attributedTo: { id: "https://example.test/users/a" },
    content: "hello",
    attachment: [{ url: "https://cdn.example/a.jpg", mediaType: "image/jpeg", alt: "photo" }],
    _misskey_quote: "https://example.test/quoted",
  });
  assertEquals(note.quote, "https://example.test/quoted");
  assertEquals(note.attachments[0].url, "https://cdn.example/a.jpg");
  assertEquals(normalizeAttachment({ href: "https://cdn.example/b.png" }).url, "https://cdn.example/b.png");
});
