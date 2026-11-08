import assert from "node:assert/strict";
import test from "node:test";
import { isNodeInfoDiscoveryDocument, isReadinessDocument, isWebFingerDocument } from "./production-contracts.mjs";

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

test("readiness accepts a successful hosted PostgREST dependency probe", () => {
  assert.equal(isReadinessDocument({
    ok: true,
    database: "reachable",
    dependency: "postgrest",
    upstream_status: 200,
  }), true);
});

test("readiness accepts a successful self-hosted PostgreSQL dependency probe", () => {
  assert.equal(isReadinessDocument({
    ok: true,
    database: "reachable",
    dependency: "self-hosted-postgres",
    upstream_status: 200,
  }), true);
});

test("readiness rejects legacy responses that do not identify the checked dependency", () => {
  assert.equal(isReadinessDocument({ ok: true, database: "reachable" }), false);
});

test("readiness rejects failed upstreams and unknown dependency types", () => {
  assert.equal(isReadinessDocument({
    ok: true,
    database: "reachable",
    dependency: "postgrest",
    upstream_status: 503,
  }), false);
  assert.equal(isReadinessDocument({
    ok: true,
    database: "reachable",
    dependency: "unknown",
    upstream_status: 200,
  }), false);
});
