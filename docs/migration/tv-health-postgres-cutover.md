# TV health: independent PostgreSQL cutover

## Why this migration exists

The scheduled TV Channel Health Monitor was still writing to the Supabase `tv_channel_health` table through the `tv-health` Edge Function. The latest observed failure returned HTTP 503 with PostgREST `PGRST002` after probing 50 channels. This meant channel checks could complete while their health records failed to persist.

## New write path

1. GitHub Actions builds the public channel catalogue and probes at most 500 channels per 15-minute run, with 12 concurrent probes and a bounded 2.5-second probe timeout.
2. The workflow requests a short-lived GitHub OIDC token for audience `testagram-tv-health`.
3. It posts batches of up to 50 results to `POST /internal/tv/health`.
4. The Go API verifies the RS256 signature against GitHub's JWKS and validates issuer, audience, repository, workflow name, workflow file/ref, main branch and allowed event.
5. The API transactionally upserts results into `testagram_tv.channel_health` in independent PostgreSQL. Success/failure streaks are updated server-side.
6. The web/TV catalogue client reads public status from `GET /api/tv/health`; it no longer reads the Supabase health tables.

## Cutover prerequisites

- Apply `migrations/20261106_tv_health_postgres.sql` using the normal reviewed migration runner after a verified backup.
- Deploy the backend version that contains `POST /internal/tv/health` and `GET /api/tv/health`.
- Configure the XClone repository Actions variable `TESTAGRAM_BACKEND_URL` with the HTTPS base URL of the deployed Go API. It is a URL, not a credential.
- Verify an authorized staging workflow run persists results and the public GET endpoint returns them.
- Only then merge/enable the frontend workflow change on `main`.

The new endpoint requires no Supabase service-role key. The existing Supabase Edge Function is left in place temporarily for rollback and historical inspection; it is no longer called by the revised scheduled workflow. Do not remove the old function/table until the production cutover is verified and the retention/export policy is agreed.

## Rollback

Rollback is a workflow/code rollback only: restore the previous monitor workflow and client adapter if the backend endpoint is unavailable. The additive PostgreSQL table is retained. No production data is deleted. Do not drop the table or reverse the migration during an incident.
