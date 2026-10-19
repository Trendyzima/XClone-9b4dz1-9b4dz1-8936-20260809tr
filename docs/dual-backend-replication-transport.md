# Replication transport deployment

This branch adds an authenticated intake Edge Function and a bounded relay Edge
Function. The relay is not scheduled automatically and inbox intake is not a
product-data projection.

## Required Edge Function secrets

- `REPLICATION_PEER_KEYS_JSON`: JSON map of allowed peer origin to shared secret,
  e.g. `{"testagram-vps":"<shared-random-secret>" }`. Use a secret manager and a
  randomly generated secret of at least 32 bytes.
- `REPLICATION_ORIGIN=xclone`
- `REPLICATION_PEER_URL=https://<testagram-host>/internal/replication/events`
- `REPLICATION_PEER_KEY=<shared-random-secret>`
- `REPLICATION_RELAY_TOKEN=<separate-random-secret-of-at-least-32-bytes>`

Invoke `replication-relay` with `Authorization: Bearer <REPLICATION_RELAY_TOKEN>`
from a trusted scheduler. It claims at most 5 events per run with a bounded lease,
signs the exact event body with HMAC-SHA256, and retries transient failures with
backoff. No scheduler is installed by this migration.

The receiver accepts only origins in `REPLICATION_PEER_KEYS_JSON`, requires a
timestamp within five minutes, limits requests to 1 MiB, rejects credential-like
payload keys, and stores the complete event in the private inbox table. Duplicate
event IDs with changed event envelopes return a conflict.

## Database setup

Apply `supabase/migrations/20261019000000_dual_backend_replication.sql` using the
normal Supabase migration pipeline. The migration creates private outbox/inbox
tables and service-role-only claim/ack/retry RPCs. Do not grant these tables or
functions to `anon` or `authenticated`.

## Semantics and release gate

A successful relay means the peer durably accepted the event; it does not mean
the receiving backend applied it to product records. Product writes are not yet
connected to outbox events and no domain projector is enabled by this change.
Keep real data replication disabled until event producers, entity-version checks,
privacy-aware projectors, tombstones, reconciliation, and stop-one-backend tests
are implemented and verified. Do not copy secrets or signed media URLs into events.


## Inbox projection worker (opt-in)

Deploy the `replication-projector` Edge Function and configure
`REPLICATION_PROJECTOR_TOKEN` with a separate random secret of at least 32
bytes. Invoke it with `Authorization: Bearer <token>` from a trusted scheduler.
It accepts POST only and calls the service-role-only
`apply_platform_replication_pending` RPC. Keep the service-role key only in the
Edge Function environment.

The projector writes to the separate `platform_replication_projection` mirror,
not directly to authoritative product tables. Only account, post, and media
events are accepted; fields are allowlisted, posts and media must be explicitly
public, and media metadata must include a checksum. Permanent schema/privacy
rejections are dead-lettered; transient storage errors are retried.

This worker does not create source events. Product writes still need atomic
outbox producers and schema-specific projectors before live product-data
synchronization can be declared complete.


## Transactional source-event producer

The migration exposes `public.enqueue_platform_replication_event(JSONB)` to
`service_role` only. A product mutation RPC must call it **inside the same
PostgreSQL transaction** as its authoritative write. The helper validates the
event envelope, enforces the XClone origin, rejects nested credential/PII keys,
bounds the payload, and treats an identical event-ID replay as idempotent while
rejecting conflicting reuse.

This helper is a producer primitive, not automatic table capture. Do not claim
live product replication until each supported mutation RPC (account profile,
public post, public media metadata, and deletion) calls it in the same
transaction, and integration tests prove that a failed business transaction
cannot leave an outbox event behind.


## Scheduled worker wiring

The repository includes `.github/workflows/replication-workers.yml`. After merging
the workflow, configure repository secrets:

- `SUPABASE_FUNCTIONS_URL`: the project functions base URL ending in
  `/functions/v1`.
- `REPLICATION_RELAY_TOKEN`: at least 32 random bytes, matching the relay
  function secret.
- `REPLICATION_PROJECTOR_TOKEN`: a separate token matching the projector
  function secret.

Keep repository variable `REPLICATION_WORKERS_ENABLED` unset or `false` until
the migration, peer HMAC keys, endpoint health checks, and restore test have
passed. Set it to `true` to enable the five-minute scheduled workflow, or use
manual dispatch for an operator-controlled run. The workflow is gated off by
default and does not run merely because the PR is opened.


The relay distinguishes transient failures from permanent peer responses. Network
errors, 5xx, 408, 425, 429, and 401 are retried with bounded exponential backoff;
other 4xx responses, origin mismatches, and oversized local events are
dead-lettered immediately. Both relay and projector report counts without
including event payloads. Investigate terminal failures before replaying them.


## Source writes and initial snapshot

The additive `20261019010000_replication_source_producers.sql` migration wires
transactional outbox events to real `public.posts` and `public.profiles` writes.
It emits only public, non-community posts from active, discoverable, unprotected
authors; profile privacy/deactivation changes and post deletions produce
tombstones. Profile payloads use an explicit allowlist and strip unstable or
query-bearing avatar URLs. Source versions are serialized per entity with
transaction-scoped advisory locks so a trigger and snapshot seed cannot race
the entity version.

After backups and the migration are verified, a service-role operator can call
`public.seed_platform_replication_public_snapshot(100)` repeatedly. It seeds
existing eligible profiles and posts in bounded batches and returns the number
created; stop when it returns zero. This does not backfill private posts,
community posts, or media binaries.

Media metadata and other domain types remain separate integration gates. Do not
enable the scheduled worker until the snapshot has been seeded and the destination
projection, deletion, and privacy behavior have passed end-to-end tests.
