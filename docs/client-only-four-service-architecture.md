# XClone client-only boundary and four-service distribution

## Purpose

XClone is a web/mobile/desktop client, not a second backend or data plane. It owns presentation, navigation, local interaction state, accessibility, client-side validation, optimistic UI and rendering. It does not own canonical records, authorization decisions, protocol state, ranking policy, durable media or infrastructure credentials.

Application request path:

Browser / Android / Desktop -> XClone UI -> Appwrite user session -> short-lived JWT -> public Testagram Backend API
Backend -> Neon primary PostgreSQL (canonical profiles, posts, social graph, permissions, visibility and transactions)
Backend -> private Federated Content API + dedicated Neon DB (ActivityPub protocol state and delivery)
Backend -> private Algorithm API (bounded candidate ranking and recommendation scores)
Backend -> Data Centre media/infrastructure services (B2 durable objects, R2 replica, integrity, lifecycle and Cloudflare delivery)
Backend -> authorized response -> XClone renders

Only the Backend is the client-facing application API. XClone must not call private Federation, Algorithm or Data Centre control-plane APIs. Federation's public ActivityPub protocol endpoints are for remote servers, not an alternate XClone application API. Local product screens use Backend facade routes.

## Ownership matrix

| Feature/data family | Authoritative owner | XClone integration |
| --- | --- | --- |
| Login, session validation, account linking, profile bootstrap, legal acceptance and account status | Backend + Appwrite | Appwrite user-facing Account SDK for sign-in/session; Backend API for canonical profile and policy |
| Profiles, posts, replies, reactions, reposts, follows, blocks, bookmarks, lists, communities, visibility and moderation | Backend + Neon | Backend public API only |
| Home feed, search/discovery orchestration, trends and feed hydration | Backend + Neon; Algorithm ranks bounded candidates | Backend public API only; never call Algorithm from browser |
| Ranking models, candidate scoring and recommendation ordering | Algorithm | No direct client calls; Backend sends candidates and reapplies visibility checks |
| WebFinger, actor documents, remote keys, inbox/outbox, ActivityPub signatures, remote delivery and fan-out | Federated Content + dedicated Neon database | Backend facade for local product screens; protocol ingress/discovery routes to Federation for remote peers |
| Upload reservations, quota, object ownership, lifecycle, integrity, replica state and private download authorization | Backend | Backend API issues bounded, expiring upload/download capabilities |
| Durable media bytes, B2 primary, R2 replica, verification/repair, backups, storage nodes, transcoding and edge delivery | Data Centre; Backend owns product authorization/lifecycle | Upload bytes may use only the short-lived signed URL returned by Backend; finalization/private download always return through Backend |
| Deployment, private networking, backups, restore drills, node health and infrastructure operations | Data Centre | No browser access to control-plane or node credentials |
| Wallet, ledger, M-Pesa, payouts, ads, subscriptions, marketplace orders and creator earnings | Backend + Neon with provider integrations server-side | Backend API only |
| Notifications, messaging, realtime tickets and preferences | Backend + Neon; transport integrations server-side | Backend API only |
| Video/live/TV metadata and external publisher integrations | Backend owns application aggregation/authorization; Data Centre owns media processing/delivery | Backend API for application data; approved playback URL only where policy permits |

## Hard security rules

1. No Neon connection string, PostgreSQL credential, Appwrite server API key, internal service token, B2 application key, R2 secret, Cloudflare signing secret, queue credential or private origin may appear in XClone source, Vite variables, mobile bundles, desktop bundles or browser storage.
2. Appwrite endpoint/project ID may be public. The browser may use the user-facing Account SDK for authentication. Server-side account linking, authorization and canonical profile writes belong to Backend.
3. Appwrite session JWTs are short-lived bearer credentials. Send them only to Backend over HTTPS. Never forward them to Algorithm, Federation or Data Centre from the client.
4. Backend authenticates users, enforces object ownership/visibility, rate limits and validates input. Hiding a UI control is not authorization.
5. Backend-to-service credentials are separate server-only secrets with least privilege.
6. Algorithm may reorder only candidate IDs supplied by Backend. Backend rejects unknown/duplicate IDs, rechecks visibility/blocks/follows and hydrates canonical records from Neon.
7. Federation owns remote protocol state, not local account or post authority. It resolves local actors through Backend and applies inbound activities through authenticated, idempotent Backend operations.
8. Backend authorizes media reservations, finalization, deletion and private retrieval. R2 remains private; Cloudflare Worker validates short-lived signed URLs.
9. No XClone direct writes to Neon, Appwrite database collections, Federation's Neon database, Algorithm storage or Data Centre control-plane databases.
10. No client fallback silently switches identity providers or sends a JWT to a different issuer.

## Existing frontend audit: migration blockers

| File/directory | Current observation | Required end state |
| --- | --- | --- |
| src/lib/supabase.ts | Creates primary and secondary Supabase SDK clients; fresh mode points them at inert loopback | Remove module and all imports after consumers are migrated |
| src/lib/dataPlane.ts | Defines primary/secondary Supabase data planes and query fallbacks | Replace with Backend API query abstractions; no browser database-plane selection |
| src/services/backendClient.ts | Imports Supabase SDK, reads Supabase session tokens and invokes Supabase Edge Functions; fresh mode rejects unported functions | Transport-only Backend API client using Appwrite JWT; replace each function with typed Backend route |
| src/services/socialApiClient.ts | Selected fresh Backend routes exist, but legacy provider selection and /api/social remain | Appwrite-only auth and Backend-only routes for every social operation |
| src/lib/auth.ts and src/services/appwriteAuth.ts | Appwrite login and Backend profile bootstrap are present | Retain; finish identity linking/lifecycle tests in Backend |
| src/services/freshMediaApi.ts | Backend reservation/finalization/private URL; direct upload to signed provider URL | Retain this shape; prove B2 integrity, lifecycle and Cloudflare private-download E2E |
| src/api/federation.ts | Legacy Supabase Edge Function invocations for federation feeds/protocol operations | Replace local product operations with Backend facade routes; no Supabase invocation |
| supabase/functions/** | Large legacy function inventory remains in XClone | Port capabilities to correct owner, verify parity, then remove old copies |
| package.json | Still depends on @supabase/supabase-js | Remove only after zero runtime imports, types, tests and build overlays remain |

Do not remove src/lib/supabase.ts, the SDK dependency or supabase/functions/** as isolated cleanup. Existing callers still depend on them. Retire only after verified replacements.

## Edge Function redistribution inventory

| Legacy function family / examples | Destination |
| --- | --- |
| identity-signup, identity-verification, identity-engine-*, account-lifecycle, identity-engine-result | Backend + Appwrite: identity, account lifecycle, verification and mapping; no admin keys in client |
| capability-gateway, community-admin-runtime, help-chatbot, ai-moderation, budget-alerts | Backend: application authorization and policy |
| heartbeat and infrastructure telemetry | Data Centre: infrastructure health, not user-facing product state |
| federated-feed, federated-discovery-feed, federation-inbox, federation-transport, federation-delivery-worker, federation-inbound-worker, mastodon-api, mastodon-edge, mastodon-federation, activitypub-keygen, gateway-relay, megalodon-gateway | Federated Content: ActivityPub state, signatures, remote delivery and protocol retries |
| federated-media, federated-media-proxy, federated-media-cleanup, media-delivery, community-space-media-upload | Backend orchestration + Data Centre media services: Backend authorizes; Data Centre handles bytes, replication, integrity and delivery |
| mpesa-stk-push, mpesa-b2c-payout, mpesa-b2c-result, creator-mpesa-payout, creator-mpesa-result, distribute-earnings, mpesa-ad-payment | Backend: provider callbacks, ledger transactions and idempotent settlement |
| community-sitemap | Backend or Cloudflare Worker: Backend supplies canonical public data; Worker may cache/render |
| matrix-bridge, matrix-message-bridge | Backend integration boundary; protocol bridge may be a separately owned worker |
| mail/notification delivery | Backend orchestration + approved mail/push provider; provider secrets server-side |

This is a routing plan, not proof that the functions have already been ported. Confirm exact source behavior, authorization and call sites before retiring each function.

## Backend API facade required

The fresh API server in Backend currently registers GET /healthz, GET /readyz, GET /readyz/platform, GET /v1/me, PUT /v1/me/profile, conditional POST /v1/identity/register, GET/PUT /v1/me/legal, GET/PUT /v1/me/federation, GET /v1/feed/home, GET /v1/feed/public, POST /v1/posts, POST /v1/moderation/check, private Federation readiness/outbox/actor routes, and media reservation/completion/download/restore routes. These are a starting subset, not complete coverage of the XClone UI.

Backend must add/finish typed routes for every UI capability before XClone removes legacy implementations: post/reply/reaction/repost/bookmark, follows/blocks/follow requests, profile sections, search/trends/discovery, communities, notifications, messaging, wallet/ledger/payments, creator analytics/monetization, ads, marketplace, video/live/TV metadata and administration. Return explicit 401/403/404/409/422/429/5xx semantics, request IDs, bounded pagination and stable response envelopes.

Do not infer endpoint availability from a frontend method name. Maintain OpenAPI in Backend and generate or validate XClone types against it.

## Cutover and acceptance gates

### Gate A — Backend first
- Backend uses Appwrite for identity/session verification and Neon for canonical application records.
- All capability RPCs become native Backend/Neon operations; no Supabase REST/RPC forwarding.
- Backend owns authorization, transactions, idempotency and audit events.
- /readyz/platform verifies real required Neon, Federation outbox and ranking dependencies, not just configured environment variables.

### Gate B — private service integrations
- Federation uses its dedicated Neon database and private Backend identity/outbox contracts.
- Algorithm is reachable only from Backend over a private authenticated service network.
- Data Centre B2 lifecycle and Cloudflare private-media delivery pass upload, checksum, repair, deletion and private retrieval tests.
- Federation inbox processing, outbox polling, fan-out and interoperability gates pass before public ActivityPub activation.

### Gate C — XClone client only
- Every UI feature uses Backend public API, except Appwrite user-facing auth SDK and direct PUT/GET to a short-lived signed media URL returned by Backend.
- No Supabase SDK, Supabase REST/RPC URL, Supabase Realtime/Storage/Edge Function invocation, PostgREST builder, Supabase environment variable, or build-time Supabase injection remains.
- No browser/mobile/desktop code contains private service URLs or internal service credentials.
- No XClone source directory deploys server-side product functions.

### Gate D — integration proof
- CI covers login, logout, refresh, verification, recovery, identity linking and profile bootstrap.
- API contract tests cover every UI capability and authorization boundary.
- E2E covers feed hydration + ranking + visibility recheck; local/remote federation; B2 upload + integrity + private delivery; payments and idempotent ledger posting.
- Production probes verify API readiness and WebFinger/ActivityPub routes after deployment.
- All five repositories' required CI and cross-service integration checks pass on the same release candidate.

### Gate E — legacy retirement
Only after Gates A-D pass: remove Supabase SDK/dependencies, environment variables, secret references, workflows, compatibility modules, Edge Function copies and obsolete migrations. Decommission Supabase infrastructure last.

## Current audit status

- The five repositories describe the intended ownership split and have partial Appwrite, Neon, federation, ranking and Backblaze B2 foundations.
- XClone still has direct Supabase usage across numerous React pages/components and the Flutter client, plus legacy build/workflow/documentation references. The IPTV build overlay and browser sitemap Edge Function call have been addressed on the migration branch; broad feature parity and full removal are not complete.
- Backend capability dispatch has native handlers for the implemented social, media, wallet and communication slices and returns 501 for unmigrated capabilities rather than forwarding to Supabase. Backend README and legacy identity-link documentation still need cleanup.
- Federation README lists incomplete inbox processing, Backend outbox polling, follower fan-out and cross-repository interoperability. Keep public federation activation gated.
- Algorithm documents the correct private ranking-only boundary: Backend supplies authorized candidates and reapplies visibility checks.
- Data Centre documents durable media lifecycle and Cloudflare private-media delivery; keep fresh media disabled until B2 integrity and private-delivery are verified.

This document defines target boundaries and acceptance criteria. It does not claim production cutover or every feature port is complete.