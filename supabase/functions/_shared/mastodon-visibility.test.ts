import { assert, assertEquals } from "jsr:@std/assert";
import { canViewMastodonStatus, normalizeMastodonVisibility } from "./mastodon-visibility.ts";

Deno.test("public and unlisted statuses are readable without a session", () => {
  assert(canViewMastodonStatus("public", "author", null, false));
  assert(canViewMastodonStatus("unlisted", "author", null, false));
});

Deno.test("private and direct statuses are never exposed to unrelated viewers", () => {
  assert(!canViewMastodonStatus("private", "author", null, false));
  assert(!canViewMastodonStatus("direct", "author", "stranger", true));
  assert(!canViewMastodonStatus("unknown", "author", "stranger", true));
  assert(!canViewMastodonStatus(null, "author", null, false));
  assert(!canViewMastodonStatus(42, "author", null, false));
  assert(canViewMastodonStatus("direct", "author", "author", false));
});

Deno.test("followers-only statuses require an accepted follower or the author", () => {
  assert(!canViewMastodonStatus("followers", "author", "reader", false));
  assert(canViewMastodonStatus("followers", "author", "reader", true));
  assert(canViewMastodonStatus("followers", "author", "author", false));
});

Deno.test("visibility maps to Mastodon values without turning direct posts public", () => {
  assertEquals(normalizeMastodonVisibility("followers"), "private");
  assertEquals(normalizeMastodonVisibility("direct"), "direct");
  assertEquals(normalizeMastodonVisibility("unlisted"), "unlisted");
  assertEquals(normalizeMastodonVisibility("unexpected"), "direct");
  assertEquals(normalizeMastodonVisibility(null), "direct");
});
