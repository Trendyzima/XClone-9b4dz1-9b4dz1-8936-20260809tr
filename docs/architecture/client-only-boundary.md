# XClone client-only boundary

XClone is the presentation/client repository in the five-repository Testagram system. It owns browser/mobile/desktop/TV presentation, local view state, client-side validation, device APIs, caching of non-authoritative data, and typed HTTP clients. It is not a backend, API gateway, database, worker, or source of truth.

## Ownership and integration

| Repository | Owns | XClone integration |
| --- | --- | --- |
| [Testagram Backend](https://github.com/Trendyzima/Testagram-backend-) | Appwrite-authenticated API, accounts, authorization, canonical profiles/posts, social graph, feed orchestration, conversations, messages, calls, wallet ledger and payment settlement | HTTPS API using a short-lived Appwrite-derived Backend JWT |
| [Federated Content](https://github.com/Trendyzima/federated-content) | ActivityPub protocol, remote actors/objects, inbox/outbox and federation delivery | Backend-mediated API; preserve remote actor/object identifiers and attribution |
| [The Algorithm](https://github.com/Trendyzima/the-algorithm) | Ranking, recommendation and candidate-scoring services | Backend feed/discovery responses; XClone renders returned order and must not rescore |
| [Testagram Data Centre](https://github.com/Trendyzima/Testagram-data-centre-) | Media object storage, replication, durability, delivery infrastructure and storage telemetry | Backend-authorized upload/download intents and signed media URLs; never expose storage credentials |
| XClone | UI and client transports only | Consumes the contracts above |

The Backend remains the canonical application authority. Federation owns protocol execution. The Algorithm owns ranking. Data Centre owns media durability. A client must never write canonical social data directly to a database or storage provider.

## Client configuration

Required public build-time configuration:

- `VITE_APPWRITE_ENDPOINT` and `VITE_APPWRITE_PROJECT_ID` for Appwrite client authentication.
- `VITE_TESTAGRAM_API_URL` for the separately deployed Testagram Backend API.
- Optional public analytics configuration only; analytics must never receive credentials, JWTs, private message contents, or identity evidence.

Only public identifiers and public origins belong in `VITE_*`. Never put Appwrite server keys, database credentials, B2/R2 keys, Cloudflare signing secrets, payment-provider secrets, service tokens, or private keys in this repository or a frontend build.

Missing API configuration must fail closed with a clear client error. Do not silently fall back to `/api/*`, a same-origin proxy, PostgREST, RPC, direct database access, or an old Edge Function.

## Feature rules

- Authentication: Appwrite client SDK establishes identity; Backend validates the short-lived JWT and authorizes every protected operation.
- Posts, profiles, follows, blocks, permissions, conversations, messages, calls and wallet: Backend API only.
- Feed ranking and recommendations: render the ordered result returned by Backend/Algorithm; no client scoring or private-signal collection.
- Federation: Backend/Federated Content contract only; XClone does not implement inbox/outbox delivery, signing, retries or federation workers.
- Media: Backend authorizes an upload/download intent; Data Centre stores and replicates bytes. XClone may upload bytes only to a short-lived URL explicitly returned by the trusted API.
- Wallet/payments: display server-returned ledger state. Never create balances, settle transactions, mark deposits successful, or reconcile payments in the browser.
- Realtime: use a documented Backend subscription/stream contract. Polling may be used only where the API contract explicitly supports it; do not recreate database realtime in the browser.
- Unsupported features: keep the UI honest and disabled/unavailable until the owning API contract is deployed. Do not ship fake success, local canonical writes, mock balances, or compatibility shims that pretend an operation succeeded.

## Change acceptance checklist

1. No Supabase SDK, PostgREST, Supabase Edge Function, direct database, or service-role references in active client source.
2. No backend handlers, server implementations, database migrations, worker implementations, or infrastructure deployment code in XClone.
3. All API calls use explicit configured service origins and typed request/response contracts.
4. All protected calls obtain a short-lived Backend JWT; no long-lived service credentials are shipped.
5. Every feature is mapped to exactly one owning repository and its contract/version.
6. Unsupported APIs fail closed and are visibly unavailable rather than being emulated in the browser.
7. Typecheck, lint, web production build, native-client checks, route validation, and contract tests pass.
8. Smoke tests verify sign-in, session refresh, public feed, authenticated feed, profile, media upload/download, and logout against deployed non-production services before production rollout.

This document describes the intended boundary; it is not evidence that every feature or live service has passed end-to-end acceptance.
