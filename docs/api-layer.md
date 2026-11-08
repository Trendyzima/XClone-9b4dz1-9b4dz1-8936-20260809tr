# XClone API integration

XClone is the web/mobile presentation client. It calls only the public Testagram Backend API at `VITE_TESTAGRAM_API_URL` (for example `https://api.testagram.site`). It must not call Algorithm, Federation, Data Centre, Neon, Appwrite Database, object providers, storage nodes or internal queues directly.

## Authentication
1. Sign in using Appwrite Auth.
2. Obtain a short-lived Appwrite JWT from the active session.
3. Send `Authorization: Bearer <JWT>` to Backend.
4. Never send an Appwrite server key or inter-service token to the browser.
5. Backend derives caller ID from the verified token; never trust client-provided owner ID.

## Request conventions
- Prefix every product route with `/v1`.
- Send `Accept: application/json`, `X-Testagram-API-Version: 1`, and a unique `X-Request-ID`.
- For mutations send an 8-128 character `Idempotency-Key`; reuse the same key only for retries of the same operation and payload.
- Treat HTTP status as authoritative. Preserve response `X-Request-ID` in safe diagnostics.
- Use bounded pagination and abortable requests. Do not retry non-idempotent mutations with a new key.
- Private responses must not be cached in shared browser/service caches.

## Current fresh API support
- Profile: `GET /v1/me`, `PUT /v1/me/profile`
- Legal/federation preferences: `GET/PUT /v1/me/legal`, `GET/PUT /v1/me/federation`
- Feeds: `GET /v1/feed/home`, `GET /v1/feed/public`
- Text posts: `POST /v1/posts`
- Media: reservation, completion, authorized download routes when Backend media feature is enabled.

Canonical API contract and OpenAPI live in Testagram Backend at `docs/fresh-platform-api.openapi.yaml`. Keep TypeScript adapters and tests here. Do not invent a second client-facing API.

## Not yet a live API
Follow/block mutations, reactions, reposts, bookmarks, replies, direct messages, voice/video calls, audio spaces, wallets and notifications require implemented Backend routes and authorization tests. UI controls for unsupported capabilities must remain disabled or fail closed; never restore Supabase/PostgREST/Edge Function fallback or call an internal service directly.
