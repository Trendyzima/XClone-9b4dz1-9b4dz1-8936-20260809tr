# Testagram: Flutter Web + Android migration plan

## Goal

Move the interactive Testagram product UI to one shared Flutter/Dart foundation for Flutter Web and native Android while preserving the original brand, backend, existing accounts and every production behavior. This is a staged migration with measurable parity gates—not a big-bang rewrite.

## Verified starting point

- Production website: React 18 + TypeScript + Vite at `https://testagram.site/`.
- Existing Android package: `com.xclone.app`, currently a WebView shell with Firebase messaging and native media permission handling.
- Existing data/auth plane: Supabase Auth, Postgres/RLS, Storage, Realtime and Edge Functions; a second Supabase project is also used by selected services and must not receive a primary-project JWT.
- Existing media/TV/ad paths include HLS.js, provider-specific IPTV/TV flows, internal ad placements, external scripts/VAST and creator monetization.
- The current public site remains production until feature parity is accepted. The Flutter build in `mobile/` is a separate client and CI artifact.

## Architecture target

```text
Flutter Web ───────────┐
                       ├─ shared Dart domain/state/repository contracts
Native Android Flutter ┘                 │
                                          ├─ Supabase Auth/Postgres/RLS/Realtime/Storage/Functions
                                          ├─ existing media APIs + CDN/R2
                                          ├─ existing capability APIs for E2EE messaging/calls
                                          └─ platform adapters: secure storage, FCM, camera/mic, picker, app links

Existing React website + existing WebView APK remain live as rollback clients until parity gates pass.
```

Shared code must not duplicate business rules already enforced by Supabase RPCs/Edge Functions. Primary and secondary Supabase projects keep separate auth/JWT boundaries. Native screens must call typed repositories/capability clients; no direct privileged credentials and no plaintext fallback for encrypted messages.

## Phase plan and acceptance gates

| Phase | Scope | Required evidence before advancing |
|---|---|---|
| 0 — inventory and guardrails | Enumerate every page, feature component, service, data-plane helper and cross-cutting domain; preserve production rollback | `scripts/validate-flutter-parity-inventory.mjs` passes; source inventory has no missing/stale entries |
| 1 — Flutter foundation | Shared theme, texture, assets, responsive navigation, routes, config boundary, error/loading states, secure session storage | `flutter analyze`, widget tests, Flutter Web release build and Android debug build pass |
| 2 — identity/auth | Password/OTP/verified signup flows, recovery, legal/age gate, session refresh, 24-hour policy, sign-out, deep links | Test existing accounts; expired/revoked session; password recovery; legal acceptance; poor network; no infinite spinner |
| 3 — social graph and feed | Home ranking, pagination, cache, post create/edit/delete, likes/reactions, replies, reposts/quotes, bookmarks, sharing, profile, follows, lists, blocks/mutes | API contract parity; idempotent writes; stale-cache recovery; screen-reader and device-size checks |
| 4 — media and short videos | Camera, microphone, media picker, uploads, retry/progress, image/video caching, vertical feed, preloading, player lifecycle, audio focus | Permission grant/deny/revoke, app background/foreground, low memory, network handoff, unsupported codec, upload failure tests |
| 5 — IPTV and TV production | Channel catalogue, provider-specific resolver, HLS playback, vertical TV feed, channel profile, TV Studio, broadcast, production/admin UI | Test real supported streams and provider responses; stable video card height; no collapsing; start/retry/error/stop lifecycle; real Android devices |
| 6 — advertising and monetization | Internal ads, external ad provider adapters, ExoClick/VAST support, sponsored labels, placement/frequency, event deduplication, analytics, creator earnings | Each provider's platform terms/SDK validated; ad labels and click destinations verified; no layout shifts or playback collisions; impression/click events reconciled |
| 7 — messaging and calls | Existing E2EE capability API, conversation list, send/receive, key lifecycle, read receipts, typing, presence, attachments, voice notes, audio/video calls | Cross-client encrypted interoperability tests; never write plaintext to encrypted tables; incoming/background call and reconnect tests |
| 8 — notifications | FCM token registration/rotation, notification categories, foreground/background delivery, deep-link taps, unread/read state, preferences | Real-device delivery tests for all app states; token refresh/revoke; denied permission; backend event idempotency |
| 9 — communities and live | Communities, memberships, spaces, speaker/listener state, events, recordings, creator/publisher/federated surfaces | Backend authorization parity, realtime reconnect and lifecycle tests |
| 10 — commerce, wallet and creator | Products, marketplace, orders, M-Pesa/payment providers, wallet ledger, savings/rewards, creator studio, scheduling, series/podcasts/analytics | Provider sandbox and idempotency tests; currency/amount invariants; permission/ownership tests; no client-trusted financial state |
| 11 — safety/admin/privacy | Moderation/report/appeal/block/mute, verification, owner/admin access, governance, audit, fraud, settings and privacy | Role/RLS negative tests; owner-only surfaces; audit evidence; no admin UI as a substitute for server authorization |
| 12 — Flutter Web parity | All routes, responsive breakpoints, deep links, public metadata, canonical URLs, sitemap/robots, PWA, cache headers, 404, share/selection/accessibility | Route-by-route production smoke tests; SEO crawl checks; no redirect loops; external ads and auth callback verified |
| 13 — staged rollout | Internal APK, canary users, web preview, telemetry, performance and rollback | Signed identity confirmed; critical error rate acceptable; login/feed/IPTV/ads/notifications smoke tests; documented rollback exercise |

## Feature completeness inventory

The generated `docs/flutter-parity-inventory.json` contains all current source files under `src/`, plus API routes, Supabase Edge Functions and migrations, and existing Android native references, plus explicit cross-cutting product domains. Every entry starts as not started unless a foundation implementation is present. A foundation label is not equivalent to production parity.

## Production cutover blockers

1. Never replace the production web deployment with the Flutter build until every route and public SEO requirement has an approved equivalent or a deliberate HTML rendering strategy.
2. Never replace the current Android APK until signing identity, FCM, deep links, session, camera/mic, uploads, IPTV and background lifecycle are validated on physical devices.
3. Do not use direct DB writes for complex capability flows (especially E2EE messaging/calls, payments, ad billing, creator earnings or privileged admin actions) when the existing app uses a service/RPC/Edge Function.
4. Do not declare an ad provider working until actual delivery, tracking, policy compliance, placement and playback coexistence have been observed.
5. Keep rollback paths and the old client until the new client passes the feature-specific contract and runtime gates.

## CI contract

`.github/workflows/flutter-clients.yml` runs Flutter formatting, analyzer, tests, Flutter Web release build and Android debug APK build. It uploads preview artifacts only. It does not deploy the web build or publish an Android release. The existing web and Android production workflows are unchanged by this foundation branch.
