# XClone ↔ Testagram backend integration contract

Status: client integration checklist; this document does not enable production routing or replication.

The backend-side ownership and release contract is maintained in [Testagram's cross-repository architecture contract](https://github.com/Trendyzima/Testagram-backend-/blob/main/docs/cross-repo-architecture-contract.md). This file records the obligations of the XClone client and CI.

## Client responsibility

- Keep Supabase Auth and existing product providers unchanged until a capability migration is explicitly accepted.
- Send the current user's access token to authenticated API routes. Do not send service-role credentials, internal platform tokens, or provider secrets from the browser.
- Keep `VITE_TESTAGRAM_API_URL` opt-in and use it only for a deployed HTTPS staging origin. Removing it must restore the existing same-origin compatibility path.
- Keep `TESTAGRAM_MEDIA_BACKEND_ORIGIN` and `TESTAGRAM_BACKEND_ORIGIN` server-side for compatibility proxies. Do not expose either as `VITE_*`.
- Preserve API response and error semantics. Do not silently fall back to another account, database, or identity provider when a route fails.

## Replication event v1

The schema source is `contracts/replication-event-v1.schema.json`. The v1 contract is closed and accepts only `schema_version: 1`; unsupported versions require a coordinated versioned rollout. Required fields are `id`, `origin`, `entity_type`, `entity_id`, `entity_version`, `schema_version`, `event_type`, `occurred_at`, and object-valued `payload`.

CI must validate the schema, source migrations, Edge Functions, and database constraints together. Keep the 1 MiB envelope limit and sensitive-field policy aligned with the Go peer. Cover nested objects and arrays, normalized camelCase/separator variants, signed URL fields, malformed timestamps, event/entity mismatches, unsupported versions, and oversized serialized envelopes.

The receiver's acknowledgement means durable acceptance only. It does not mean the destination projection has been applied. The mirror table is not an authoritative product table. Keep replication workers opt-in until source transactionality, tombstones, idempotency, retries, dead-letter handling, and reconciliation are proven.

## Media integration

The compatibility route in `api/media.ts` calls the server-configured backend origin. The browser transfers bytes to the signed URL; it should not proxy large media through the application API unless the selected route contract explicitly requires that behavior.

Release verification must cover authenticated upload intent, signed PUT, provider-observed completion, attachment authorization, public CDN rendering, private download authorization, cross-account denial, expiry, retry/idempotency, and deletion/orphan cleanup. Keep public and private storage/cache paths isolated. A successful frontend build is not evidence that the live R2/MinIO lifecycle works.

## Rollout gates

- [ ] Contract validator and PostgreSQL integration gate pass.
- [ ] Backend Go tests and XClone typecheck/lint/build pass on reviewed commits.
- [ ] Existing sign-in and RLS denial behavior remain unchanged through staging.
- [ ] Public projection allowlists reject private/community content and sensitive fields.
- [ ] Privacy transitions/deletions cannot be undone by delayed events.
- [ ] Media lifecycle and private-object denial pass against real staging infrastructure.
- [ ] Metrics, logs, queue age, permanent failures, and alert delivery are observed during smoke tests.
- [ ] Rollback to existing client routes is exercised.
- [ ] Feature flags remain off until the release owner accepts all evidence.

Migrate one feature family at a time. Do not treat a green CI run, a durable replication acknowledgement, or a successful deploy as proof of end-to-end production compatibility.
