# XClone monorepo decomposition — five-repository ownership map

Status: forensic source-tree inventory and target ownership proposal. This document is not a claim that all moves or runtime migrations are complete.

## Executive decision

XClone is now the **client repository**. It keeps web, Flutter/Android, Android TV and desktop presentation code, client-side state, route composition, API adapters, local caching and UI tests. It must not remain the source of truth for backend services, protocol workers, recommendation ranking, database schema, media durability or node orchestration.

The intended request path is:

`Web / Flutter / TV / Desktop (XClone) → public Testagram Backend API → private Federation / Algorithm / Data Centre contracts`

Only XClone talks to end users. Backend authenticates requests, authorizes actions and owns canonical product state. Internal services never trust browser-supplied identity or visibility claims.

## Repository responsibilities

| Repository | Owns | Must not own |
|---|---|---|
| XClone | Web/mobile/TV/desktop UI, route and navigation, view models, client API adapters, client-side cache/offline behavior, playback controls, UI analytics adapters | Canonical user/post data, secrets, authorization policy, database migrations, server workers, ActivityPub execution, ranking decisions, media durability |
| Testagram Backend | Appwrite identity bridge and sessions, canonical profiles/posts/social graph, follows/blocks/mutes, permissions/visibility, communities and product state, transactional events, public/private APIs, business workflows, payments/ledger, notifications, moderation/governance, commerce, API orchestration | ActivityPub wire protocol, ranking policy, binary storage durability or host/node orchestration |
| Federated Content | WebFinger, ActivityPub actors and keys, remote actor discovery, signed inbox verification, protocol outbox, inbound processing, outbound delivery, remote content/reaction projections and federation-specific retention | Local account identity, canonical local posts, local authorization/visibility, product wallet or media ownership |
| the-algorithm | Candidate ranking, recommendations, interest affinity, relevance scoring, diversity, trend/discovery ranking, ranking evaluation and model versions | Canonical posts/users/social graph, authorization, candidate visibility decisions, public user APIs |
| Testagram Data Centre | Deployment, private networking, compute/control plane, Android storage nodes, computer/server nodes, B2/R2 object durability, CDN/media transfer, video processing, backups, restore, observability and infrastructure operations | Product identity, social policy, feed ranking or ActivityPub account policy |

## What was found in XClone

The default-branch tree contains 1,594 files:
- `src/`: 493 files (198 pages, 163 components, 35 services, 30 libraries, 23 modules, 16 hooks and supporting files).
- `mobile/`: 195 files (Flutter application, platform integration, feature screens and tests).
- `api/`: 20 server/API route files.
- `services/`: 45 files across Testagram CDN, edge, mail and identity-engine services.
- `supabase/functions/`: 125 files, including 98 `index.ts` function entrypoints and shared/runtime configuration.
- `supabase/migrations/`: 425 SQL migration files, plus secondary migrations and Supabase project configuration.
- `cloudflare/`, `ops/`, `android/`, `android-tv/` and `desktop/`: deployment, worker, operational and client-platform code.

This is not a simple frontend repository yet. The largest architectural debt is the embedded Edge Function and migration estate, plus service implementations and client modules that still directly query legacy Supabase.

## Feature-by-feature distribution

### 1. Keep in XClone — presentation and client integration

Keep these feature surfaces and their UI implementations in XClone:
- Authentication, signup, identity verification, profile and settings **screens**.
- Home/feed, post/thread composers, replies, likes, reposts, bookmarks, lists and polls **screens and interaction controls**.
- Communities, chat/messages, notifications, spaces, calls and live-room **screens**.
- Fediverse discovery, profile, inbox, remote post and federation status **screens**.
- Search, Explore, trends, hashtag, suggested accounts and sports **screens**.
- Stories, images, video, podcasts, TV and live streaming **players and presentation controls**.
- Creator studio, analytics, monetization, ads, boosts and payouts **dashboards**.
- Wallet, M-Pesa, PayPal/Pesapal, marketplace, products, orders and seller storefront **screens**.
- Admin, governance, moderation, appeals, staff, regulator and fraud **console UI**.
- Flutter application, Android manifests/native integration, Android TV UI, desktop/Tauri shell, routing, accessibility, localization, local caching and offline presentation.
- Typed API clients, request/response adapters, token acquisition, client-side validation and UI-level optimistic updates. Client validation is convenience only; Backend repeats every security-sensitive validation.

**Do not move page/component files merely because their names refer to backend domains.** Move the server authority behind those pages and preserve the existing UX through versioned API adapters.

### 2. Move to Testagram Backend — canonical product and business capabilities

Move/port server-side logic and database ownership for:
- Identity lifecycle: signup orchestration, Appwrite account mapping, profile provisioning, sessions, account closure, identity verification/KYC workflow state and verified-user gates.
- Profiles: profile data, handles, profile settings, followers/following, privacy and profile sections.
- Social core: posts, threads, replies, quote posts, likes/reactions, reposts, bookmarks, polls/votes, lists, follows, blocks, mutes, visibility, counters and idempotency.
- Communities: membership, roles, posts, events, community shops and moderation permissions.
- Messaging product state: conversations, message metadata, delivery state, call invitations and notification preferences. External protocol adapters are separately owned; encrypted payloads should remain opaque to Backend where end-to-end encryption requires it.
- Notifications: device registration, preferences, durable notification records, delivery intents, idempotency and provider dispatch orchestration.
- Wallet and financial product domain: balances, double-entry ledger, transfers, savings, credits, rewards, referrals, tips, boosts, payment intents, settlement, reconciliation, fraud controls and payout authorization.
- Payment provider adapters: M-Pesa STK/B2C, PayPal, Pesapal, webhook/IPN verification and idempotent settlement. Provider secrets and callbacks remain server-side.
- Commerce: marketplace catalogue, seller/storefront, inventory reservations, orders, delivery state, checkout, commissions, disputes and seller settlement.
- Ads and monetization: campaign configuration, eligibility/policy, budgets, ad decision authorization, impressions/click events, billing, creator earnings and payout ledgers. Ranking/auction scoring may call Algorithm; financial settlement remains Backend.
- Governance and trust: admin/staff roles, regulator workflows, appeals, reports, audit records, moderation decisions, account restrictions and enforcement.
- Product services: ride booking/fare/payment domain, sports product APIs, Newsify/RSS source configuration and content metadata, podcast metadata, TV channel catalogue/entitlements/chat interactions, help/support and SEO metadata where canonical product data is required.
- Capability registry and public API contracts, rate limits, idempotency, audit, outbox and transactional event production.

**Backend target:** one public API, Appwrite-verified identity, PostgreSQL canonical state, strict authorization, durable jobs and private calls to internal services. Browser/mobile clients must not call Appwrite Database, Neon, Federation, Algorithm, B2/R2 or Data Centre directly.

### 3. Move to Federated Content — ActivityPub protocol execution

Move/port these server capabilities:
- WebFinger and local actor discovery; actor documents and actor key lifecycle.
- Remote actor and signing-key discovery/cache.
- Signed HTTP inbox ingress, signature/Digest/Date validation, replay protection and remote URL/IP safety.
- Protocol inbox persistence, inbox processor and idempotent inbound activity application.
- Protocol outbox, Backend transactional-outbox polling, recipient resolution, follower fan-out and recipient deduplication.
- Signed outbound delivery, retries, leases, acknowledgements, dead-letter recovery and delivery observability.
- ActivityPub Create/Update/Delete/Follow/Undo/Accept/Reject/Like/Announce/Block and supported compatibility activities.
- Remote posts, remote reactions/replies, remote profile metadata, instance discovery and federation-specific retention.
- Mastodon/Megalodon/ActivityPub interoperability adapters and federation-specific Matrix/bridge code only where it is genuinely a protocol adapter.

**Boundary:** Backend decides whether a local account may publish, follow, block or view an object. Federation executes the protocol and stores remote protocol state. Federation must resolve local users through Backend; it must never create local accounts or override Backend visibility. Remote media bytes and durable replicas belong to Data Centre, not Federation.

### 4. Move to the-algorithm — scoring and recommendations

Move/port server-side scoring and ranking:
- Home feed candidate ranking, relevance score, recency decay, engagement weighting and author diversity.
- Interest graph, hashtag/topic affinity and personalized discovery ranking.
- Suggested accounts and follow recommendations.
- Trending topic/hashtag/video ranking and trend velocity.
- Search result ordering and recommendation ranking, while Backend owns query authorization and result visibility.
- Related content, creator/content recommendations and ranking of eligible federated candidates.
- Notification recommendation prioritization where it uses relevance models.
- Offline evaluation, ranking metrics, feature definitions, model/weight versioning and A/B experiment analysis.

The current `src/services/recommendations.ts` is a clear extraction candidate: it loads follows, blocks, mutes, interests, likes, browsing history and posts directly from Supabase and calculates ranking in the frontend. Replace this with Backend-built, authorized candidate batches and server-derived, privacy-reviewed signals sent to the private ranker. The ranker returns ordered IDs and explainable reasons only. Backend rechecks visibility and hydrates canonical records before XClone receives them.

**Never send raw private messages, secrets, unrestricted user histories or sensitive attributes to ranking.** Backend remains the policy enforcement point. If Algorithm is unavailable, Backend should use a safe chronological fallback.

### 5. Move to Testagram Data Centre — infrastructure, media and nodes

Move/port infrastructure and binary-media responsibilities:
- Android storage-node application/service, removable SD-card validation, node enrollment, heartbeats, capacity reports, storage reservations, replication and repair.
- Computer/server nodes, node agents, private worker scheduling, compute capacity and workload lifecycle.
- VPS/Compose/systemd deployment, private service networking, TLS/origin configuration, secrets injection, service health and infrastructure monitoring.
- Backblaze B2/Cloudflare R2 bucket configuration, multipart transfers, object verification, checksum, replica placement, durability, retention, deletion, restore and lifecycle cleanup.
- CDN/edge delivery, cache policies, media token enforcement, public/private media paths, signed upload/download transfer and origin failover.
- Video processing, FFmpeg/transcoding, HLS/DASH packaging, posters/thumbnails, stream health and media job queues.
- TV/live media transport, ingest, relay, recording storage and playback infrastructure. Backend retains channel ownership, broadcast authorization, schedules and product interactions.
- Backups, disaster-recovery drills, restore tooling, capacity/load tests, node repair and operational dashboards.

XClone retains the media picker, upload progress UI, playback controls, offline media cache and client peer-assisted delivery only where it remains a browser feature. It must call Backend to authorize upload/download lifecycle and Data Centre through Backend-issued short-lived grants. Do not put B2/R2 keys or internal node credentials in the client.

### 6. Split capabilities — two or more repositories collaborate

| Feature | Backend owns | Other owner |
|---|---|---|
| Home feed | Authentication, candidate authorization, pagination, canonical hydration | Algorithm ranks; Federation may supply eligible remote candidates |
| Search | Query API, privacy/visibility filters, canonical result hydration | Algorithm ranks/relevance; Federation provides remote index candidates |
| Federated post | Local post and visibility decision | Federation signs/delivers protocol activity; Algorithm may rank eligible remote content |
| Media upload | User authorization, asset metadata, lifecycle state and grant issuance | Data Centre accepts bytes, verifies object and maintains replicas/CDN |
| TV/live | Channel ownership, host/guest permissions, schedule and chat | Data Centre ingest, transport, recording, transcode and delivery |
| Ads/boosts | Campaign policy, wallet, billing, creator settlement and audit | Algorithm may score eligible ads/content; Data Centre serves assets/CDN |
| Notifications | Durable event, preferences, policy and delivery intent | Data Centre runs workers/queues and provider connectivity; Algorithm may prioritize |
| Creator analytics | Canonical events, privacy and financial totals | Algorithm may compute engagement/recommendation aggregates; Data Centre hosts telemetry |
| Ride/marketplace | Orders, pricing rules, payment, fraud, delivery state | Data Centre provides hosting/maps/provider connectivity only; do not move product ledgers there |
| News/podcasts/sports | Product metadata, user interactions and entitlement | Data Centre runs ingestion/scheduled workers; Algorithm ranks; XClone renders |

## XClone source locations that need attention

| Existing source area | Disposition |
|---|---|
| `src/pages/**`, `src/components/**`, `src/components/features/**` | Keep UI in XClone; replace direct data access with typed Backend clients |
| `mobile/lib/features/**` and `mobile/lib/core/**` | Keep mobile UI and client adapters; no private service credentials or direct database access |
| `src/services/appwriteAuth.ts`, `src/services/backendClient.ts`, `src/services/socialApiClient.ts` | Keep as client-side auth/API adapters; align all methods to versioned Backend contracts |
| `src/services/recommendations.ts` | Remove Supabase data loading and frontend ranking; call Backend feed API, with Backend invoking Algorithm |
| `src/modules/payments/**`, `src/modules/monetization/**` | Keep only UI orchestration and display models in XClone; move ledger, payment verification, settlement, fraud and entitlements to Backend |
| `src/lib/supabase.ts` and direct `supabase.from/rpc/functions/storage` callers | Remove only after equivalent Appwrite JWT + Backend API contracts exist and tests prove parity; do not replace with direct Neon/Appwrite DB calls from clients |
| `api/**` | Audit each route: product authority/payment/identity routes go to Backend; SEO rendering may remain a thin XClone/server adapter; media bytes/ingest go to Data Centre; no route may become a second business-logic authority |
| `services/testagram-identity-engine/**` | Backend-owned identity/KYC worker and state machine; deployment can be hosted by Data Centre |
| `services/mail/**` | Backend owns transactional email intent/outbox and templates; Data Centre owns host/service deployment and network operations |
| `services/testagram-cdn/**`, `services/testagram-edge/**`, `cloudflare/**` | Data Centre owns media edge/CDN service lifecycle and infrastructure; preserve only browser-side loader/client code in XClone |
| `src/services/virtualCdn*.ts`, `src/services/tvCdn.ts`, media URL/player modules | Keep client-side playback/cache/peer logic where safe; all origin authorization, durable objects, tokens and replication move behind Backend/Data Centre contracts |
| `supabase/functions/**` | Remove from XClone only after every source has a verified owner, is ported or deliberately retired, and callers/workflows have moved |
| `supabase/migrations/**`, secondary migrations and config | Split schema by data ownership. Backend owns canonical product schema; Federation owns protocol schema; Algorithm owns ranking-specific schema only if durable ranking state is needed; Data Centre owns infrastructure/node/media metadata schema. Never bulk-copy all migrations into one target. |

## Legacy server inventory: first-pass allocation

The former XClone tree contains 98 Edge Function entrypoints (125 files including shared code/config). The first-pass allocation is:

- **Backend:** identity/signup/KYC/account lifecycle; Testagram API/capability gateway; profile/post/social/community; wallet/payment/creator earnings/ads; moderation/governance; notifications/push; marketplace/ride; Newsify/RSS/podcast/sports product APIs; product email and provider webhooks.
- **Federated Content:** ActivityPub keygen, federation transport/inbox/outbound delivery/inbound workers, Mastodon/Megalodon adapters, federated feed/discovery/projection and remote-media protocol proxy. Backend still authorizes local visibility; Data Centre owns durable media storage.
- **the-algorithm:** ranking, recommendation, discovery, trending and search-scoring logic currently embedded in frontend or edge functions. The Edge Function that gathers candidates or checks authorization should be split: Backend gathers and authorizes, Algorithm scores.
- **Data Centre:** R2/media token/delivery and cleanup workers, CDN/TV media proxy/playback/health/stream control, replication/repair/retention infrastructure and service heartbeat/operations where it describes host/node health.
- **XClone:** no server Edge Function should remain as a product authority. Keep only client presentation/API adapters and, if needed, thin server-side rendering/SEO adapters.

This is an allocation guide, not a mechanical one-to-one rename. Some existing functions combine several domains and must be decomposed before moving.

## Migration risks and blockers found

1. **Backend API parity is incomplete.** XClone's `docs/central-backend-api-contract.md` explicitly lists home-feed reads and idempotent text-post creation as the two fresh operations currently supported. Follow/block, reactions, reposts, bookmarks, replies, notifications, federation writes, media attachment/delivery and capability dispatch are not yet ported and must fail closed. The large UI surface cannot be switched to fresh mode until these contracts exist.
2. **Legacy dependencies remain in the frontend.** `src/services/recommendations.ts` directly queries Supabase tables and scores posts in the client. `src/services/backendClient.ts` still has a legacy Supabase function invocation path. The old Supabase directory and direct imports remain in the tree.
3. **Federation is not complete.** The Federation README reports actor discovery, persisted actors/keys, signed ingress and durable delivery primitives, but the inbox processor, Backend outbox poller, follower fan-out and end-to-end interoperability remain outstanding. Do not enable public delivery merely because the worker exists.
4. **Algorithm is a bounded baseline, not a production ML claim.** The Testagram feed module is a deterministic Go ranker; Backend must remain able to fall back chronologically and recheck every candidate.
5. **Data Centre service catalogue contains mixed/partial capabilities.** Node, media, hosting and restore functionality needs end-to-end evidence against real devices and B2/R2; source presence or a passing build does not prove durability or production capacity.
6. **Migration history is not portable by path rename.** The 425 SQL migrations contain mixed ownership, duplicate/reconciliation history and Supabase-specific functions/RLS/RPC. Extract schema and business behavior by domain, write new target migrations, and test from a clean target database. Do not replay all legacy migrations in any one repository.
7. **Potential duplicate services exist.** XClone contains both `services/testagram-cdn` and `services/testagram-edge`, plus Cloudflare workers and browser-side virtual CDN code. Choose one Data Centre-owned media-edge contract; retain browser-only code in XClone and retire duplicate server deployments only after traffic/caller audit.
8. **Client route compatibility is a release gate.** Every move needs an API contract, typed client adapter, auth/authorization tests, idempotency and pagination behavior, telemetry, staging E2E, feature flag and rollback.

## Recommended migration order

1. **Freeze ownership and contracts:** approve this map; make Backend the sole public product API and prohibit new server business logic in XClone.
2. **Identity and social core:** complete Appwrite JWT verification and Backend APIs for profiles, follows/blocks, posts, replies, reactions, reposts, bookmarks, polls, lists and communities. Preserve existing XClone screens.
3. **Media lifecycle:** finish upload intent, signed transfer, provider verification, attachment authorization, private download, CDN delivery, deletion and replica recovery across Backend + Data Centre.
4. **Federation:** complete Backend transactional outbox integration, Federation inbox processing, signed outbound delivery, fan-out, retries/dead letters and Mastodon interoperability.
5. **Algorithm:** move feed/discovery/trend scoring behind the private ranker; Backend supplies bounded eligible candidates and performs final authorization.
6. **Product domains:** migrate messaging/notifications, wallet/payments, ads/creator earnings, marketplace/ride, TV/live, Newsify/podcasts/sports, moderation/governance and admin workflows in vertical slices.
7. **Remove XClone server ownership:** delete legacy Edge Functions, Supabase migrations/config, duplicate workers and provider-specific code only after each domain passes its migration gate and all workflows/callers are updated.
8. **Release verification:** run clean-database migrations, Go tests/race/vet, frontend typecheck/lint/build, Flutter analyze/tests/builds, security scans and end-to-end flows across all five repositories.

## Definition of done for each extracted feature

- Named owner repository and one canonical source of truth.
- Versioned API/event contract and generated/checked client types.
- Authentication and authorization tested at the owning Backend boundary.
- Idempotency, retry, timeout, pagination and failure semantics defined.
- No secret or private service token in XClone/browser/mobile artifacts.
- Database schema and migrations live only with the owning service.
- Metrics, structured logs, request IDs and dead-letter/reconciliation paths exist.
- Contract tests plus cross-repository staging E2E pass.
- Feature flag and rollback path are exercised.
- XClone preserves the user-facing feature without owning its server implementation.
