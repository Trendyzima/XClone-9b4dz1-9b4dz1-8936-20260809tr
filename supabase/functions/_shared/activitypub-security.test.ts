import { assertEquals, assertThrows } from "jsr:@std/assert";
import { assertCanonicalPublicUrl, assertSafeRemoteUrl, canonicalUrl } from "./activitypub-security.ts";

Deno.test("canonical URLs always use Testagram's HTTPS origin", () => {
  assertEquals(canonicalUrl("/users/alice"), "https://testagram.site/users/alice");
  assertEquals(assertCanonicalPublicUrl("https://testagram.site/users/alice").hostname, "testagram.site");
});

Deno.test("remote URLs require HTTPS and reject embedded credentials", () => {
  assertEquals(assertSafeRemoteUrl("https://mastodon.social/@alice").hostname, "mastodon.social");
  assertThrows(() => assertSafeRemoteUrl("http://mastodon.social/users/alice"));
  assertThrows(() => assertSafeRemoteUrl("https://user:password@mastodon.social/users/alice"));
  assertThrows(() => assertCanonicalPublicUrl("https://user:password@testagram.site/users/alice"));
});

Deno.test("remote URL validation blocks private IPv4, local names and special-use ranges", () => {
  for (const host of ["localhost", "service.local", "api.internal", "127.0.0.1", "127.1", "10.0.0.8", "192.168.1.5", "172.16.1.2", "169.254.169.254", "0.0.0.0", "224.0.0.1", "100.64.0.1", "169.254.1.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "255.255.255.255"]) {
    assertThrows(() => assertSafeRemoteUrl(`https://${host}/`));
  }
});

Deno.test("remote URL validation blocks private IPv6 destinations", () => {
  for (const host of ["[::]", "[::1]", "[fc00::1]", "[fd12::1]", "[fe80::1]", "[ff02::1]", "[::ffff:127.0.0.1]", "[2001:db8::1]", "[2001:10::1]", "[2001:0::1]"]) {
    assertThrows(() => assertSafeRemoteUrl(`https://${host}/`));
  }
});
