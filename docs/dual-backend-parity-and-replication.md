# Dual-backend functional parity and isolated operation

## Target architecture

Backend A (the existing XClone/Supabase/Cloudflare/Redis/Upstash stack) and Backend B (self-hosted Testagram VPS) are peer implementations of the same product backend contract. Neither is a proxy or subordinate dependency for the other. Each must implement the same API capabilities and authorization semantics while retaining its own runtime, credentials, database/storage authority and operational lifecycle.

## Capability parity matrix

Track every public API capability in a versioned contract and require both implementations to pass the same contract suite:

- Authentication/session verification and account lifecycle
- Profiles, follows, blocks and privacy
- Posts, replies, likes, reposts, bookmarks and attachments
- Home, following, profile, trending and federated feeds
- Unified search, discovery and recommendations
- Media intents, upload completion, checksums, private retrieval and deletion
- Notifications, inbox, push-delivery jobs and unread state
- Communities, membership, moderation and reports
- Messaging/live features where already supported
- Rate limits, abuse prevention, audit events and data export/deletion
- Health/readiness, metrics, backups and restore procedures

For each capability record: route/schema, auth policy, error format, idempotency behavior, data owner, parity test, and rollout status. Do not mark a capability complete merely because a route exists.

## Data ownership and replication

Functional parity does not imply magically shared state. Define an explicit replication policy per entity:

- Assign each write an immutable event ID, entity ID, origin backend, monotonically increasing entity version, schema version, and timestamp.
- Use a transactional outbox at the source and an idempotent inbox/deduplication table at the destination; do not rely on Redis as a durable replication log.
- Use at-least-once delivery with idempotent consumers, retries with jitter, dead-letter handling, and replay/reconciliation tooling.
- Define a single writer/owner per entity by default. For user/profile/post writes, either home each account to one backend or define conflict resolution before allowing writes in both places.
- Never use last-write-wins for security, moderation, deletion, privacy or ownership changes without a deliberate policy. Deletions must propagate as durable tombstones.
- Treat search indexes, feed caches, counters and notification delivery as rebuildable projections, not canonical records.
- Keep legacy records and media keys unchanged. Replicate media only through a verified copy workflow that checks checksum, destination authorization and metadata before publishing the destination reference.

## Independence and failure behavior

- Each backend can authenticate and serve its own data while the peer is down, within its documented consistency boundary.
- A peer outage pauses replication and cross-backend queries, not local writes to entities owned by the healthy backend.
- Never make a peer API call synchronously mandatory for a local post, upload or profile write. Commit locally with an outbox event, then replicate asynchronously.
- Do not silently fall back to a peer for writes without a durable operation ID and owner/authority check.
- Health checks, deployment, secrets, database roles, object-store credentials, metrics and backup credentials are separate.
- Explicitly document shared account-level dependencies; independent application servers alone do not isolate a shared identity provider, DNS, Cloudflare account or network.

## API compatibility

Maintain a language-neutral OpenAPI contract and common black-box conformance suite. Both backends must agree on routes, request/response schema, pagination, error codes, auth scopes, idempotency keys, timestamps and deletion semantics. Use versioned schemas and backward-compatible additive changes; reject unknown privileged fields rather than trusting client-supplied owner IDs.

## Acceptance tests

1. Run the same API contract suite against both backends and compare expected semantics.
2. Stop A: B serves its owned records and accepts local writes; its replication backlog grows durably and drains after A returns.
3. Stop B: A serves its owned records and accepts local writes; backlog drains after B returns.
4. Deliver the same event repeatedly and out of order; no duplicate post, charge, notification or media row is created.
5. Test conflicting updates, account blocks, private posts, moderation and deletions across backends.
6. Replicate media, verify SHA-256 and metadata, then authorize private reads only through the owning backend.
7. Rebuild feed/search projections from canonical data and replay the event log.
8. Restore each backend independently from its own off-host backup.
9. Measure and publish replication lag, failed events, dead-letter count, conflict count, storage pressure and restore RPO/RTO.

## Rollout order

1. Inventory endpoints and existing data on both repositories.
2. Define OpenAPI and shared conformance tests.
3. Close capability gaps on each implementation without replacing existing services.
4. Add durable outbox/inbox and event versioning.
5. Enable replication for a low-risk entity in staging; prove outage/replay/reconciliation.
6. Add post/profile/media replication only after privacy, deletion, and ownership semantics pass.
7. Enable progressively and retain rollback paths. Do not claim zero data loss or automatic disaster recovery until tested.
