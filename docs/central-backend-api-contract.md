# XClone -> centralized Testagram Backend contract

XClone is the only frontend. In fresh mode it authenticates through the fresh Appwrite Auth project, obtains a short-lived Appwrite JWT, and sends it to the Backend public `/v1` API. It must never call Appwrite Database, object providers, Algorithm, Federation or Data Centre directly.

The Backend is the only canonical product API and authorization authority. Browser-supplied user IDs are selectors only; the Backend derives the caller identity from the verified Appwrite JWT. Browser bundles must never contain service credentials.

Current supported fresh endpoints: `GET /v1/me`, `PUT /v1/me/profile`, `GET /v1/feed/home`, text-only `POST /v1/posts`, media upload reservation/completion and owner-authorized download. The home feed verifies the Appwrite JWT, loads candidate-scoped follow/block state, enforces account and post visibility, and calls Algorithm with only a bounded authorized candidate page. Text-post creation requires `Idempotency-Key` and supports `public`, `followers` and `private` visibility. Media upload reservations now carry explicit lifecycle scope metadata, but media attachment linking and non-owner media delivery are not enabled yet. Follow/block mutations, reactions, reposts, bookmarks, replies, notifications, federation writes and capability dispatch remain unported. Those features must continue to fail closed and must not fall back to Supabase Edge Functions, PostgREST, RPC or storage.

The fresh-mode `backendClient` obtains user JWTs from Appwrite and refuses legacy Supabase Edge Function invocation. The social API uses Appwrite JWT for the two ported operations only: home-feed reads and idempotent text-post creation. Every other social route remains fail-closed. Capability dispatch is explicitly blocked in fresh mode until its centralized Backend endpoint is implemented. Legacy mode is retained separately for existing compatibility; it is not the fresh runtime.

Contract rules: `/v1` prefix, JSON, request IDs, `Idempotency-Key` on mutations, bounded pagination/body sizes, no-store for private responses, structured error codes and no credential/body leakage in logs. Keep API clients and tests in this repository; do not add a separate API-client repository.


## Shared API transport

Web features use one shared `testagramApi` instance backed by `testagramApiClient`. It obtains short-lived Appwrite JWTs, sends API version and request ID headers, disables cookie credentials and browser caching, bounds request timeouts, and retries only transient safe GET requests. Mutations are never automatically replayed; callers supply/persist idempotency keys for supported writes. API errors retain status, machine code, request ID and Retry-After metadata.

Use `requestBackendAPI<T>()` for new public Backend operations. It rejects unversioned paths and must not be used for private service routes. Do not add direct Appwrite Database, Neon, B2/R2, Federation, Algorithm or Data Centre calls to the browser.
