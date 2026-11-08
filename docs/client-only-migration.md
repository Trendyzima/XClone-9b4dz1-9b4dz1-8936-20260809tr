# XClone client-only boundary and feature migration

## Decision

XClone is a presentation client. It owns rendering, navigation, accessibility, input collection, local ephemeral UI state, client-side media playback, and calling public Testagram APIs. It does not own application business rules, authoritative state, persistence, authorization, payment execution, federation protocol execution, ranking, notification delivery, or infrastructure control.

All persistent and privileged operations must be executed by the owning Testagram backend service. XClone may retain typed API adapters and view-model transformations, but not a second implementation of business logic.

## Non-negotiable client boundary

Allowed in XClone:
- React/UI components, pages, navigation, styling, accessibility and localization.
- Form validation for immediate user feedback; the server repeats all security/business validation.
- Ephemeral view state, optimistic UI that reconciles with server responses, client caches and pagination state.
- Appwrite end-user authentication SDK operations needed to sign in and obtain a short-lived user JWT.
- HTTPS requests to the public Backend API.
- Rendering server-issued media URLs and browser-native playback.
- Public, non-sensitive analytics events.

Forbidden in XClone:
- Supabase Auth, PostgREST, Storage, Realtime or Edge Function runtime dependencies.
- Direct Neon/PostgreSQL access or database credentials.
- Direct calls to private Federation, Algorithm, Data Centre, worker, queue or internal platform endpoints.
- Service keys, signing keys, payment provider secrets, storage credentials or internal service tokens.
- Authoritative wallet/ledger calculations, payment settlement, entitlement decisions, moderation decisions, access control, feed ranking, notification dispatch, federation signing/delivery or durable message/call state.
- Silent fallback to a legacy data plane when the Backend API fails.

Appwrite's public client SDK is permitted for end-user identity/session operations only. Appwrite server API keys and privileged database operations remain Backend-only.

## Service ownership

| Domain | Authoritative owner | XClone responsibility |
| --- | --- | --- |
| Authentication, account lifecycle, profile, settings, legal consent, sessions | Testagram Backend + Appwrite identity | Sign-in UI; send user JWT; render returned profile |
| Posts, threads, replies, quotes, likes, reposts, bookmarks, polls, follows, blocks, lists | Testagram Backend | Compose and render; invoke public API |
| Home/global/local feeds, search, trends, recommendations | Backend orchestration; Algorithm ranks candidates | Query and render paginated results |
| Direct messages, conversations, attachments, read receipts, delivery state | Testagram Backend | Message composer and conversation UI |
| Voice/video call lifecycle, participants, permissions, signalling authorization | Testagram Backend; Data Centre/realtime transport | Call controls and media device UI |
| Audio Spaces, speakers, listeners, moderation, recording metadata | Testagram Backend; Data Centre realtime/media | Stage and listener UI |
| Wallets, credits, ledger, transfers, savings, payouts, refunds | Testagram Backend | Display server-calculated balances and transaction results |
| M-Pesa, PayPal, Pesapal, subscriptions, premium, creator payouts | Testagram Backend payment adapters/workers | Checkout forms and provider redirect/SDK UI only |
| Ads, campaigns, billing, targeting, analytics, boosts | Testagram Backend | Ad slots and campaign-management UI |
| Communities, roles, membership, governance, reports, appeals, moderation | Testagram Backend | Community and safety UI |
| Marketplace, products, orders, delivery, rides, settlement | Testagram Backend | Browse and checkout UI |
| Notifications, preferences, push registration and delivery | Backend; Data Centre delivery adapters | Display notifications; request permission/register token |
| ActivityPub actors, WebFinger, inbox/outbox, remote follows and delivery | Federated Content; Backend owns local identity/authorization | Render federated responses via Backend API |
| Ranking, recommendations and candidate scoring | The Algorithm; Backend filters and hydrates canonical records | Render ranked result order |
| Upload authorization, media lifecycle, replication, archive/restore, CDN | Backend + Data Centre + CDN | Request upload reservation; upload only to server-authorized URL; render signed URL |
| TV/IPTV catalog, channel health, stream entitlements | Backend + Data Centre | Player and catalog UI |
| AI assistants, support, transcription, moderation providers | Backend-owned orchestration | Prompt/input UI and render response |

## Source inventory discovered in XClone

These are migration sources, not proof that the listed feature is currently fully implemented or operational.

| Existing source area | Required disposition |
| --- | --- |
| `src/services/backendClient.ts`, `src/services/socialApiClient.ts` | Retain as thin public API adapters; remove Supabase function invocation and legacy token paths |
| `src/lib/supabase.ts`, `src/lib/dataPlane.ts` | Retire after all callers have moved to Appwrite identity and Backend API |
| `src/api/federation.ts`, `src/features/federation/`, `src/hooks/useFediversePolling.ts` | Keep display adapters only; route local and remote operations through Backend |
| `src/modules/payments/` | Move payment orchestration, verification, transaction state and wallet persistence to Backend |
| `src/modules/monetization/` | Move ledger, fraud detection, entitlements, idempotency and wallet middleware to Backend |
| `src/features/*` | Keep presentation and API-facing hooks; remove direct persistence and business policy |
| `src/pages/MessagesPage.tsx`, `src/pages/CallPage.tsx`, Live Audio/Space components | Keep UI; move message/call/space state machines, permissions and durable events to Backend |
| `src/components/features/Wallet*`, `src/hooks/useWallet.ts`, `src/hooks/usePayment.ts` | Keep display and interaction; use Backend wallet/payment contracts |
| `src/pages/*`, `src/components/features/*` | Audit every feature screen and map every query/mutation to a public API contract |
| `supabase/functions/**`, `supabase/migrations/**` | Treat as migration source material only; port behavior and tests to owning service before deletion |
| `api/**`, `services/**` | Audit for server handlers and private integrations; move ownership to the dedicated Backend/Data Centre/Federation services |

## Migration order and release gates

1. Inventory every frontend Supabase import, `from()`, `functions.invoke()`, `storage`, realtime subscription, direct database query, serverless route and privileged operation.
2. Map every call to an existing public Backend route or a new typed API contract. Unknown routes are migration blockers, not reasons to retain a hidden fallback.
3. Implement missing Backend endpoints and database migrations with authorization, validation, pagination, idempotency, auditability and tests.
4. Move protocol-specific Federation behavior to Federated Content; ranking to Algorithm; media durability and realtime infrastructure to Data Centre.
5. Replace frontend service modules with typed API-only adapters. Keep UI components and feature behavior.
6. Add contract tests for every API adapter and end-to-end tests for each user journey.
7. Remove Supabase SDK/dependencies, configuration, Edge Functions and migrations only after no runtime caller remains and all replacement acceptance tests pass.
8. Deploy Backend services before switching the frontend. Verify readiness, login, profile, feeds, social writes, media, messaging, payments, federation and realtime in production.

## Definition of done

- No Supabase SDK, URL, key, auth, PostgREST, storage, realtime or Edge Function calls in the XClone runtime.
- No direct database or private-service calls from browser/mobile clients.
- All durable feature state and security decisions are server-authoritative.
- Every visible feature has a documented, implemented, versioned Backend API contract.
- API errors remain visible; no fake success or silent legacy fallback.
- Web, Android, TV and desktop clients use the same public API contracts.
- CI, typecheck, lint, build, API contract tests and end-to-end smoke tests pass.
- Supabase source material is removed only after its behavior has been ported and verified.

## Current audit note

The current XClone default branch still contains Supabase client construction and feature code that invokes Supabase functions/database APIs. The Backend fresh API has only a subset of the full product surface (identity/profile/legal/federation preference, home/public feeds, post creation/moderation, media lifecycle and internal federation contracts). Therefore this document establishes the target and migration inventory; it does not claim that XClone is already a pure read-only client or that every backend endpoint exists.


## Complete legacy Edge Function inventory

The current XClone tree contains **98** function entrypoints under `supabase/functions/**/index.ts`. Each must be classified, ported, and covered by a replacement test before the directory can be removed.

| Function family | Existing function entrypoints | Destination |
| --- | --- | --- |
| Identity and account | `account-lifecycle`, `identity-engine-result`, `identity-engine-worker`, `identity-signup`, `identity-verification`, `submit-identity-verification`, `testagram-auth-email`, `testagram-magic-link`, `testagram-security-email` | Backend + Appwrite |
| Capability/API gateway | `capability-gateway`, `gateway-relay`, `testagram-api`, `heartbeat`, `service-health` | Backend; remove legacy Supabase RPC proxy |
| Social discovery and feeds | `federated-discovery-feed`, `federated-feed`, `search-discovery`, `trending-hashtag-alert` | Backend + Algorithm; Federation for remote protocol reads |
| ActivityPub/Fediverse | `activitypub-keygen`, `federation-delivery-worker`, `federation-inbound-worker`, `federation-inbox`, `federation-transport`, `mastodon-api`, `mastodon-edge`, `mastodon-federation`, `megalodon-gateway` | Federated Content, orchestrated by Backend |
| Messaging bridges | `matrix-bridge`, `matrix-message-bridge` | Backend messaging; optional protocol bridge isolated as adapter |
| Media and storage | `community-space-media-upload`, `federated-media-cleanup`, `federated-media-proxy`, `federated-media`, `media-delivery`, `post-media-upload`, `profile-media-upload`, `r2-media`, `testagram-media-token` | Backend authorization + Data Centre storage/CDN |
| Notifications | `notification-delivery-worker`, `notification-fcm-worker`, `novu-notification-delivery`, `push-notification-delivery`, `register-push-token` | Backend notification domain + Data Centre delivery |
| Wallet, payments and payouts | `creator-mpesa-payout`, `creator-mpesa-result`, `distribute-earnings`, `mpesa-ad-payment`, `mpesa-b2c-payout`, `mpesa-b2c-result`, `mpesa-config-status`, `mpesa-stk-push`, `mpesa-stk-status`, `paypal-capture-order`, `paypal-create-order`, `paypal-payout-status`, `paypal-payout`, `paypal-webhook`, `pesapal-create-order`, `pesapal-ipn`, `pesapal-sync-order`, `premium-paypal-capture-order`, `premium-paypal-create-order` | Backend payment adapters, wallet ledger and workers |
| Advertising and monetization | `budget-alerts`, `testagram-ad-asset-upload`, `testagram-ad-campaign`, `testagram-ads`, `zenad-ad-asset-upload`, `zenad-campaign`, `zenad-decision`, `zenad-event` | Backend ads/monetization; Algorithm only for ranking |
| Communities and content governance | `ai-moderation`, `community-admin-runtime`, `community-sitemap` | Backend; moderation provider adapter stays server-side |
| News, podcasts and external content | `newsify-feed`, `newsify-sync`, `podcast-rss`, `testagram-rss-feed`, `testagram-rss-ingest`, `tenor-proxy`, `testagram-sports` | Backend integration services |
| TV and streaming | `tv-catalog`, `tv-cdn-playback`, `tv-health`, `tv-media-control`, `tv-stream-proxy` | Backend catalog/entitlements + Data Centre/CDN |
| Rides and geospatial | `ride-distance`, `ride-fare`, `ride-geocode`, `ride-service` | Backend rides domain; external maps provider server adapter |
| AI and support | `help-chatbot`, `transcribe-audio` | Backend AI/support orchestration |
| Replication and operations | `replication-projector`, `replication-receiver`, `replication-relay`, `sitemap-refresh`, `sitemap-users`, `og-image`, `og-meta` | Backend event/API and SEO service; Data Centre for infrastructure replication |

The shared `supabase/functions/_shared/**` utilities must also be audited. Security, ActivityPub signing/validation, delivery, observability, CORS, replication contracts, mail and Redis helpers must be reimplemented or relocated to the owning server repository; do not copy browser-inappropriate privileged code into XClone.

**Deletion gate:** do not delete any of the 98 entrypoints merely because the frontend no longer imports the Supabase SDK. Confirm scheduled triggers, webhooks, provider callbacks, deployment workflows and external callers have been redirected to their replacement service.
