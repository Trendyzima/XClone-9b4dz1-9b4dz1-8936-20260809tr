# Testagram disaster recovery

## Source-of-truth boundaries
- Supabase/Postgres: durable application data, accounts, profiles, posts, metadata and notification state.
- Cloudflare R2: durable media bytes.
- Cloudflare Worker: replaceable media delivery edge.
- Upstash Redis: replaceable cache/control plane; Redis loss must not imply data loss.
- Firebase FCM: replaceable push transport; notification state remains in Supabase.

## Recovery sequence
1. Restore Supabase/Postgres from the latest available backup or logical dump.
2. Apply and verify the repository migration history.
3. Re-establish Edge Functions and secrets from the deployment environment.
4. Re-deploy the Cloudflare CDN Worker and re-attach cdn.testagram.site.
5. Verify R2 media objects and the cdn.testagram.site/health contract.
6. Recreate/flush Upstash cache state. Never treat Redis as authoritative data.
7. Reconcile Firebase FCM credentials and verify background push delivery.
8. Run health, readiness, CDN, authenticated smoke tests and the load baseline.

## Database backups
Supabase-managed backup availability depends on the plan. For Free projects, maintain regular logical exports with the Supabase CLI and keep them off-site. Never commit production dumps to Git.

## Restore drill
A recovery drill is successful only when a fresh environment can be reconstructed from repository migrations, the database backup, R2 media objects, deployment configuration and provider secrets stored outside Git.

The repository CI drill verifies that the database can be rebuilt from zero using all committed migrations. A production restore must use a separate recovery project/environment; never run a destructive restore against live production as CI.

## Media recovery
R2 is the media source of truth. The CDN Worker is replaceable. Keep media object keys stable and keep metadata in Supabase so a replacement edge can serve the same objects.

## Redis recovery
Upstash Redis contains cache/control-plane state only. It may be rebuilt empty. The application must repopulate media routes, notification token cache, hot feed/search caches, rate-limit counters and other derived state.

## Completion gates
- /api/health returns 200 with the expected deployment identity.
- /api/ready returns 200 with database=reachable.
- CDN health returns 200.
- Representative media returns through cdn.testagram.site.
- Security review shows no newly introduced critical/high finding.
- Notification outbox drains and FCM delivery succeeds.
- Load results record request count, concurrency, error rate and p95/p99 latency.