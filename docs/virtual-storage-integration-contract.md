# XClone ↔ Testagram Virtual Storage Integration Contract

## Purpose and compatibility promise

This contract connects the XClone client to the self-hosted Testagram Go API and its logical Virtual Storage layer without replacing existing product data or silently moving current media. Existing hosted/Vercel + Cloudflare R2 behavior remains the rollback path until the self-hosted deployment passes the release gates below.

## Ownership boundaries

- **XClone web/mobile:** UI, authenticated session, bounded upload flow, checksum calculation, and media attachment request.
- **Testagram Go API on the VPS:** authorization, upload intents, one-time upload claims, bounded byte transfer, checksum verification, lifecycle state, quota enforcement, deletion jobs, and private-download authorization.
- **Supabase Auth/Postgres:** canonical identity and product/media metadata. Existing rows remain authoritative; migrations are additive and must be backed up before applying to an existing database.
- **Object storage:** private MinIO on the owned VPS is the self-hosted default; Cloudflare R2 is an optional S3-compatible provider. The API owns provider credentials and signed operations.
- **Cloudflare:** public DNS/CDN/edge protections and public-media delivery only. Private media must bypass public cache and must not be exposed through a public bucket or cache rule.
- **Redis/Valkey/Upstash:** ephemeral cache, rate limits and queue acceleration only. They are not the source of truth for ownership, quota, or object lifecycle; durable state remains in PostgreSQL.

## Client configuration

For a self-hosted build, set these at build time:

```dotenv
VITE_TESTAGRAM_SELF_HOSTED=true
VITE_TESTAGRAM_API_URL=https://api.testagram.site
VITE_SUPABASE_URL=https://<your-owned-supabase-origin>
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

The API URL must be an HTTPS origin without a path, query, fragment, or credentials. HTTP is permitted only for localhost development. The Supabase URL/key must point to the intended owned Auth instance; never use a service-role key in Vite variables.

When self-hosted mode is off, preserve the existing hosted media compatibility route. Do not enable self-hosted mode by setting only one variable or route production traffic to a backend that has not passed the gates.

## Upload and lifecycle contract

1. Client validates the current public media allow-list and 20 MiB cap.
2. Client requests `POST /api/media/upload-intent` with the active Supabase bearer token and metadata.
3. API derives owner from verified JWT claims and returns a short-lived relative URL for `PUT /api/media/upload?key=...`.
4. Client validates that the URL resolves to the configured API origin and exact upload path, then sends raw bytes with the exact `Content-Type` and bearer token. It never forwards the bearer token to an object-store or unrelated origin.
5. API atomically claims the intent, enforces the reserved byte limit while streaming, rejects replay/oversize/wrong-type uploads, and marks it uploaded only after storage accepts the bytes.
6. Client computes SHA-256 over the uploaded bytes and calls `POST /api/media/complete` with `key`, `visibility`, `content_type`, and `checksum_sha256`. API verifies stored bytes and persists provider-observed metadata; ETag is not a checksum.
7. If a post ID was supplied, client calls `POST /api/media/attach` only after completion. An attachment failure is surfaced with the media key so it can be retried without re-uploading.
8. Private retrieval uses `POST /api/media/private-download-url`; deletion uses `POST /api/media/delete`. Both are owner-scoped and server-authorized.

Treat backend responses as untrusted input. Reject malformed success envelopes and unsafe upload URLs; preserve HTTP status, error code and request ID for diagnostics. Do not log bearer tokens, signed URLs, raw upload bytes, or private user content.

## Legacy data and rollout

- Do not rename or rewrite existing media keys/URLs in place.
- Existing rows marked `legacy-media` continue through the legacy provider path.
- New logical namespace mappings are opt-in behind `VIRTUAL_STORAGE_ENABLED=false` by default.
- Keep hosted routing and legacy objects available until rollback has been exercised.
- Do not switch the feature flag on merely because a build passes.

## Required staging release gates

- Confirm deployed API commit implements the one-time upload state machine, bounded upload route and checksum verification expected by this client.
- Apply reviewed migrations to a restored staging copy first; for existing VPS volumes, run the documented backup-and-migrate procedure because PostgreSQL init scripts do not run on existing volumes.
- Test concurrent/replayed intent PUTs (exactly one succeeds), fixed-length and chunked oversized bodies, interrupted uploads, wrong content type, expiry, checksum mismatch, and cross-account access.
- Test upload → completion → post attachment → public CDN render, private download, owner-only delete, retryable deletion, expired-intent cleanup and orphan cleanup against real MinIO or R2.
- Verify public CDN origin path mapping for tenant-prefixed objects and prove private responses bypass cache.
- Confirm quota accounting is transactional and independent of Redis availability.
- Restore database and object data from an off-host backup and verify login, public media, private media and post playback.
- Confirm Prometheus targets, Grafana media/API panels, disk-pressure alerts and actual Alertmanager receiver delivery.

## Rollback

Disable `VIRTUAL_STORAGE_ENABLED`, revert the client self-hosted build configuration, and return to the existing hosted compatibility path. Do not delete buckets or rewrite metadata as part of rollback. Keep any virtual objects and their metadata until a separately reviewed reconciliation/migration plan exists.

## Current limits

This document defines the cross-repository contract; it is not evidence that a production VPS, DNS/CDN mapping, external notification receiver, or off-host restore has passed. Public upload remains capped at 20 MiB until API, edge limits, temporary-spool disk capacity, checksum implementation and tests are upgraded together.
