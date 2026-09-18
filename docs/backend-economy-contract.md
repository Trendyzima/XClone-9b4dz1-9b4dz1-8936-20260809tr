# Testagram economical backend contract

## Target
Support up to 50,000 monthly active users while minimizing recurring infrastructure cost and preventing Postgres/media depletion.

## Planes
- **Supabase:** Auth, PostgreSQL text/metadata, RLS, small relational records, lightweight RPCs.
- **Cloudflare R2:** all user-uploaded binary media (images/video/audio/assets). Postgres stores metadata and object keys only.
- **Vercel:** web delivery plus short-lived privileged/serverless API work. Do not proxy media bytes through Vercel.
- **Browser:** direct Supabase Data API for normal text reads/writes and direct R2 uploads/downloads through short-lived signed URLs.

## Hard limits
- Never store binary media in Supabase Postgres or Supabase Storage for the social feed.
- Current media upload ceiling: 20 MiB/object.
- Use cursor/keyset pagination for feeds and discovery.
- Select only required columns; never use broad `select(*)` on hot paths.
- Keep serverless database connections stateless; prefer Supabase Data API for read-heavy traffic.
- Privileged server functions must authenticate the Supabase access token before performing owner/admin operations.
- R2 credentials are server-side secrets only.
- No automatic database reset, migration repair, rebase, or destructive recovery in self-healing workflows.

## Cost-control targets
- Supabase Free is treated as the initial target: 50,000 MAU, 500 MB database, 5 GB egress, 500,000 Edge Function invocations.
- R2 is the media plane; its current free allowance includes 10 GB-month storage, 1M Class A requests, 10M Class B requests, and free egress.
- Vercel compute is reserved for privileged/bounded work rather than every database read or media byte.

## Scale-up trigger
If database size, egress, active users, or function usage approaches quota, measure first. Upgrade only the constrained plane rather than moving the whole stack.
