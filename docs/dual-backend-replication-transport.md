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
from a trusted scheduler. It claims at most 20 events per run with a bounded lease,
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
