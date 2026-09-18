# Economical 50K backend boundary

## Ownership

- Supabase owns authentication, PostgreSQL, text, metadata, RLS and small transactional records.
- Cloudflare R2 owns images, video, audio and other binary media.
- Vercel Functions own short-lived privileged application operations and R2 signing/validation.
- The browser uploads media directly to R2 using short-lived signed URLs.
- Media bytes never pass through Supabase or Vercel.

## 50K cost guardrails

1. Keep `media_assets` metadata-only: object key, type, size, status and URL.
2. Never store media blobs or base64 in PostgreSQL.
3. Never proxy media uploads/downloads through Vercel.
4. Prefer cursor pagination and explicit columns; avoid `select(*)` on hot paths.
5. Keep Realtime for genuinely live features only.
6. Keep Vercel functions stateless and short-lived; no persistent database pools.
7. Validate media type and size before signing and validate the uploaded object again on completion.
8. Keep Supabase and Vercel spend controls/alerts enabled before production traffic.

## Current media path

Browser -> Vercel /api/media (JWT verification + signed URL + metadata control) -> Cloudflare R2

Browser -> Cloudflare R2 (binary upload)

Vercel /api/media -> Supabase media_assets (metadata only)

The legacy Supabase r2-media function remains temporarily for rollback/verification. The web client now uses /api/media.

## Why this split

Cloudflare R2 currently includes 10 GB-month, 1 million Class A operations and 10 million Class B operations per month at no charge, with no Internet egress fee. Paid Standard storage is $0.015/GB-month. This makes R2 the media plane rather than Supabase Storage.

Supabase Free currently includes 50,000 monthly active users, 500 MB database size and 5 GB egress, but only 1 GB file storage. Therefore the economical design keeps Supabase focused on text/metadata and does not count media against its storage quota.

Vercel Pro currently includes 1 million function invocations per month; the architecture avoids using functions for ordinary feed reads or media transfer so function usage is reserved for control-plane operations.
