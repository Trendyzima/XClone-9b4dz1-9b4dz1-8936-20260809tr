# Sports Hub

The Sports Hub is available at `/sports` and is linked from the primary sidebar.

## Data sources

- **Scores and fixtures:** the public, read-only `testagram-sports` Supabase Edge Function proxies SportScore's widget API. This avoids relying on a host-specific `/api/*` runtime route; the browser sends the existing publishable key, never a provider secret. The page displays the required "Powered by SportScore" attribution link.
- **Sports headlines and images:** the existing Testagram RSS ingestion tables and feed endpoint. The initial sources are BBC Sport (GB) and The Standard Sports (KE). Ingestion extracts RSS/Atom media, enclosures and embedded images, then resolves Open Graph/Twitter image metadata for a small bounded batch of image-less stories from those trusted publisher domains. Article metadata requests have a short timeout, a 256 KiB response cap and checked redirects. Only publisher headlines/excerpts and canonical source links are shown; articles remain on their publishers' sites. Missing/broken thumbnails render a branded local fallback rather than an empty hole.
- **Provider adapters:** OpenScore is an architectural reference. FotMob-powered and other football API repos are not activated as live upstreams because public reachability does not by itself grant permission to scrape or redistribute data.

## Refresh and retention

- The existing RSS worker continues on its already-configured 15-minute schedule using the existing Supabase publishable-key configuration; no new API key is introduced.
- Imported items in category `sports` expire after three hours.
- The existing `testagram-rss-retention` job is scheduled every three hours and calls `cleanup_testagram_rss_items()`.
- The cleanup routine only deletes imported RSS cache rows that have expired or are beyond the existing RSS retention window. It does not delete user-authored posts, comments, or saved content.
- Score requests are proxied with short-lived HTTP caching and a bounded upstream timeout; the browser never needs a provider credential.

## Deployment notes

Apply the migration `20261009110000_sports_hub_ingestion_retention.sql` and deploy the updated `testagram-rss-ingest` Edge Function. Verify the existing ingestion and retention jobs in `cron.job`, then inspect source status fields (`last_success_at`, `last_error`, `next_fetch_at`) and test `/api/sports?kind=matches&sport=football`.

SportScore attribution and upstream terms must remain respected. The free tier has provider-defined request limits and may change.


## Sports Hub presentation

- The page uses a high-contrast sports masthead, sport selector, live-score grouping, featured editorial story and responsive headline cards.
- Headline taps expand a local preview; the original publisher is an optional external action.
- Scores and headlines fail independently, and score requests are cancelled when the selected sport changes. Score data is refreshed every 60 seconds; RSS content remains on the existing ingestion and cache schedule.
