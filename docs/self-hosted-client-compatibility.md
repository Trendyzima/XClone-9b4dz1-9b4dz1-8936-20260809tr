# Self-hosted Testagram client compatibility

## Required environment

For a self-hosted build, set these values at build time:

- `VITE_TESTAGRAM_SELF_HOSTED=true`
- `VITE_SUPABASE_URL`: the operator-owned Supabase-compatible API/Auth origin
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the publishable key for that same instance
- `VITE_TESTAGRAM_API_URL`: the origin of the self-hosted Go API

The API must trust tokens issued by the same Auth instance. Do not use a hosted project's token against a self-hosted API or point the client at one Auth issuer while the API verifies another. If the secondary Supabase client is not separately configured, self-hosted mode uses the same configured local endpoint instead of the legacy hosted secondary project.

When `VITE_TESTAGRAM_SELF_HOSTED=true`, the client fails at startup if the primary URL/key are absent and refuses to fall back to hosted project defaults. Media operations also refuse the legacy hosted media path if `VITE_TESTAGRAM_API_URL` is absent. This switch is intentionally opt-in so existing hosted builds are not silently broken during migration.

## Media compatibility

The client sends a raw `PUT` of the file bytes to the API-provided upload URL, attaches the bearer token only to the API upload gateway, and includes SHA-256 in the completion request. The backend is authoritative for authorization, MIME, size, checksum, expiry, and cleanup.

The current public-media allowlist is JPEG, PNG, WebP, AVIF, GIF, MP4, and WebM, with a 20 MiB maximum. Raise limits only after changing backend validation, reverse-proxy limits, temporary spool capacity, object-storage policy, and automated tests together.

## Before release

Run `npm run typecheck`, `npm run typecheck:api`, `npm run lint`, and `npm run build`; then execute the backend/client integration acceptance plan in the backend repository's `docs/platform/client-backend-compatibility.md`. CI results must be checked on the exact proposed commit. Do not turn on production virtual storage until live upload, checksum mismatch, replay/concurrency, cross-account denial, public delivery, private download, deletion, and isolated restore tests all pass.
