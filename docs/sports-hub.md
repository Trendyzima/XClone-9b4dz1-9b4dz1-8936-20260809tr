# Sports Hub

The Sports Hub is available at `/sports` and is linked from the primary sidebar.

## Data sources

- **Scores and fixtures:** server-side `/api/sports` proxy to SportScore's documented public widget API. No API key is required for its attribution tier. The page displays the required "Powered by SportScore" link.
- **Sports headlines:** the existing Testagram RSS ingestion tables and feed endpoint. The initial sources are BBC Sport (GB) and The Standard Sports (KE). Only short headlines/excerpts and canonical source links are shown; articles remain on their publishers' sites.
- **Provider adapters:** OpenScore is an architectural reference. FotMob-powered and other football API repos are not activated as live upstreams because public reachability does not by itself grant permission to scrape or redistribute data.

## Refresh and retention

- The RSS worker is scheduled every 15 minutes and requires the existing Vault secret `newsify_worker_token`; no new API key is introduced.
- Imported items in category `sports` expire after three hours.
- `testagram-sports-content-retention` runs every three hours and calls `cleanup_testagram_rss_items()`.
- The cleanup routine only deletes imported RSS cache rows that have expired or are beyond the existing RSS retention window. It does not delete user-authored posts, comments, or saved content.
- Score requests are proxied with short-lived HTTP caching and a bounded upstream timeout; the browser never needs a provider credential.

## Deployment notes

Apply the migration `20261009110000_sports_hub_ingestion_retention.sql`, deploy the updated `testagram-rss-ingest` Edge Function and deploy the updated Supabase function config. Verify both scheduled jobs in `cron.job`, then inspect the worker's source status fields (`last_success_at`, `last_error`, `next_fetch_at`) and test `/api/sports?kind=matches&sport=football`.

SportScore attribution and upstream terms must remain respected. The free tier has provider-defined request limits and may change.
