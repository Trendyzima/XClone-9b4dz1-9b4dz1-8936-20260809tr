# Cloudflare R2 media storage

Trendyzima stores **post text/descriptions and media metadata in Supabase/Postgres**, while the binary image/video bytes live in **Cloudflare R2**.

## Hard media policy

- Maximum image/video size: **20 MiB (20,971,520 bytes)**.
- Accepted images: JPEG, PNG, GIF, WebP, AVIF.
- Accepted videos: MP4, WebM, QuickTime/MOV, Matroska.
- The browser validates the limit before upload.
- The Supabase Edge Function validates it again before issuing the upload URL.
- The completion step performs an R2 `HEAD` and rejects/deletes an object if its final byte size or MIME type does not match the authorized upload.
- Supabase never receives the media bytes.

## Required Supabase Edge Function secrets

Configure these secrets for the `r2-media` Edge Function:

```text
R2_ACCOUNT_ID=<Cloudflare account id>
R2_ACCESS_KEY_ID=<R2 API token access key>
R2_SECRET_ACCESS_KEY=<R2 API token secret>
R2_MEDIA_BUCKET=<R2 bucket name>
R2_PUBLIC_BASE_URL=https://<your-media-domain>
```

Never put `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY` in Vite environment variables or browser code.

## R2 bucket

Create an R2 bucket and configure browser CORS for the production application origin. For presigned browser uploads, allow `PUT` and `Content-Type`; if media is served directly from the bucket/custom domain, allow `GET` as well.

Recommended production origin:

```text
https://www.testagram.site
```

If the production hostname changes, update the R2 CORS policy rather than allowing `*`.

## Upload flow

```text
Browser File
   │
   │ validate <= 20 MiB + MIME
   ▼
Supabase Edge Function: r2-media
   │  authenticate user
   │  create media_assets metadata row
   │  generate 15-minute presigned PUT
   ▼
Cloudflare R2
   │  browser uploads bytes directly
   ▼
Supabase Edge Function: r2-media / complete
   │  R2 HEAD validation
   │  mark media_assets uploaded
   ▼
Post creation
   │
   └── stores text/description + media reference/URL in Supabase
```

The Supabase `media_assets` table is metadata only. Its existing 20 MiB database constraint remains authoritative for the recorded byte size.
