# Flutter migration: release gates and execution plan

## Current audited baseline

This plan is based on the checked-in route inventory and feature-domain inventory as of 2026-10-13. Re-run the route inventory generator and CI before treating these counts as current.

- Unique source routes including wildcard: 212
- Source routes excluding wildcard: 211
- Explicit Flutter feature-native/partial route matches: 135
- Native migration-shell routes: 76
- Legacy website fallbacks: 0
- Product domains tracked: 22

A native route means only that a GoRouter declaration exists. It does not prove UI, backend, permissions, error recovery, accessibility, or platform parity.

## Non-negotiable migration rules

1. Do not remove or disable the existing web implementation until the equivalent Flutter journey has passed acceptance on Flutter Web and Android.
2. Do not mark a domain complete based only on route registration or compilation.
3. Every migrated journey must cover success, unauthenticated access, authorization denial, empty data, loading, offline/timeout, retry, and recovery.
4. Backend authorization and database RLS remain authoritative; hiding controls in Flutter is not authorization.
5. Ads must never collapse a feed item or interrupt the IPTV player lifecycle. Label paid placements as Sponsored and validate event ownership server-side.
6. Keep privileged service-role credentials out of Flutter Web and Android artifacts.
7. Every release candidate must identify the exact commit SHA and link its CI run and artifacts.

## Work sequence

### Gate 0 — Establish reproducible evidence

- Regenerate `docs/flutter-route-parity.json` and validate the feature inventory.
- Run formatting, strict analyzer, Flutter tests, Flutter Web release build and Android build.
- Capture the exact commit SHA and every workflow job result.
- Treat missing status data as unknown, never as green.

### Gate 1 — Security and session correctness

- Test Supabase RLS with at least two users and anonymous sessions.
- Test session restore, refresh, expiry, explicit logout and protected deep links.
- Test edge functions directly, bypassing the UI, for forged identity and unauthorized admin actions.
- Exercise media proxy redirect, DNS/IP validation, response-size, timeout and rate-limit cases.
- Confirm payment webhooks and wallet mutations are idempotent and ledger-consistent.

### Gate 2 — Core social journeys

- Feed pagination, refresh, cache invalidation and duplicate prevention.
- Compose, upload, edit/delete, comments, reactions, reposts, bookmarks and reporting.
- Profile edit, follow graph, blocks/mutes and profile deep links.
- Messaging and notifications only count as complete after send/receive, permission, retry and lifecycle tests pass.

### Gate 3 — IPTV and production studio

- Test real licensed streams: manifest, segment, key, redirects, range requests and expiry.
- Test startup, channel switching, repeated vertical swipes, background/foreground, disposal, timeout and retry.
- Assert that a failed stream or ad leaves the player container at a stable size and shows an explicit recovery state.
- Test studio create/start/stop, stream status, guests, permissions and owner-only actions.
- Validate Android TV focus/remote navigation on target hardware if Android TV is a supported target.

### Gate 4 — Ads and commerce

- Test eligible/no-fill/error ad responses, sponsored labeling, placement pacing, frequency caps and event deduplication.
- Verify external network scripts are restricted to web-only surfaces and cannot run with privileged app access.
- Test campaign funding, payment confirmation, activation windows and click/impression event ownership.
- Test marketplace checkout, M-Pesa callbacks, refunds/retries and ledger invariants.

### Gate 5 — Route closure and release

- Replace remaining migration shells and verify partial routes in feature slices, with route-specific tests.
- For each slice, update the route progress gate only when actual native behavior exists.
- Validate responsive web, Android navigation/back behavior, deep links, accessibility and localization.
- Produce a signed Android release artifact, run upgrade/install smoke tests, and verify the deployed Flutter Web artifact on a staging URL before cutover.
- Keep rollback to the previous production web release available until canary acceptance passes.

## Definition of done for a domain

A domain is complete only when all are true:

- All relevant source routes have native implementations or an explicitly approved exception.
- Success, auth/permission, empty/loading, network failure and recovery paths are tested.
- Backend contracts and RLS/authorization have been verified.
- Flutter Web and Android tests pass.
- Relevant accessibility and responsive behavior have been checked.
- No critical or high-severity defect remains open.
- CI evidence and the tested commit SHA are attached to the release record.

## Progress guard

`scripts/validate-flutter-route-progress.mjs` prevents route coverage from regressing below the audited baseline of 135 native matches / 76 migration shells / 0 legacy fallbacks. When coverage improves, update its thresholds in the same pull request to ratchet the baseline forward. This guard measures route accounting only; it must never be presented as proof that all features work.
