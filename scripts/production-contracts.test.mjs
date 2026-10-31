import assert from "node:assert/strict";
import test from "node:test";
import { isNodeInfoDiscoveryDocument, isWebFingerDocument } from "./production-contracts.mjs";

test("NodeInfo discovery accepts both supported schema links", () => {
  assert.equal(isNodeInfoDiscoveryDocument({
    links: [
      { rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: "https://testagram.site/nodeinfo/2.1" },
      { rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: "https://testagram.site/nodeinfo/2.0" },
    ],
  }), true);
});

test("NodeInfo discovery rejects missing schema versions or empty URLs", () => {
  assert.equal(isNodeInfoDiscoveryDocument({
    links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: "https://testagram.site/nodeinfo/2.1" }],
  }), false);
  assert.equal(isNodeInfoDiscoveryDocument({
    links: [
      { rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: "" },
      { rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: "https://testagram.site/nodeinfo/2.1" },
    ],
  }), false);
});

test("WebFinger accepts the requested account with a self link", () => {
  assert.equal(isWebFingerDocument({
    subject: "acct:crissbeat@testagram.site",
    links: [{ rel: "self", type: "application/activity+json", href: "https://testagram.site/users/crissbeat" }],
  }, "acct:crissbeat@testagram.site"), true);
});

test("WebFinger rejects a wrong subject or a missing self link", () => {
  assert.equal(isWebFingerDocument({
    subject: "acct:someoneelse@testagram.site",
    links: [{ rel: "self", href: "https://testagram.site/users/someoneelse" }],
  }, "acct:crissbeat@testagram.site"), false);
  assert.equal(isWebFingerDocument({
    subject: "acct:crissbeat@testagram.site",
    links: [{ rel: "http://webfinger.net/rel/profile-page", href: "https://testagram.site/@crissbeat" }],
  }, "acct:crissbeat@testagram.site"), false);
});