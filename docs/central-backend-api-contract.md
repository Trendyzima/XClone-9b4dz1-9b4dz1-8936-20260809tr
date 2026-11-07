# XClone -> centralized Testagram Backend contract

XClone is the only frontend. In fresh mode it authenticates through the fresh Appwrite Auth project, obtains a short-lived Appwrite JWT, and sends it to the Backend public `/v1` API. It must never call Appwrite Database, object providers, Algorithm, Federation or Data Centre directly.

The Backend is the only canonical product API and authorization authority. Browser-supplied user IDs are selectors only; the Backend derives the caller identity from the verified Appwrite JWT. Browser bundles must never contain service credentials.

Current supported fresh endpoints: `GET /v1/me`, `PUT /v1/me/profile`, `GET /v1/feed/home`, media upload reservation/completion and authorized download. The home feed is the first ported social read: Backend verifies the Appwrite JWT, loads candidate-scoped follow/block state, enforces account and post visibility, and may call Algorithm with only the bounded authorized candidate page. Follow/block mutations, post creation, reactions, reposts, bookmarks, replies, notifications and capability dispatch remain unported. Those features must continue to fail closed and must not fall back to Supabase Edge Functions, PostgREST, RPC or storage.

The fresh-mode `backendClient` now obtains user JWTs from Appwrite and refuses legacy Supabase Edge Function invocation. The social API defaults to Appwrite JWT when fresh mode is active. Capability dispatch is explicitly blocked in fresh mode until its centralized Backend endpoint is implemented. Legacy mode is retained separately for existing compatibility; it is not the fresh runtime.

Contract rules: `/v1` prefix, JSON, request IDs, `Idempotency-Key` on mutations, bounded pagination/body sizes, no-store for private responses, structured error codes and no credential/body leakage in logs. Keep API clients and tests in this repository; do not add a separate API-client repository.
