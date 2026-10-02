# Testagram security hardening audit

## Verified on 2026-10-02
- Supabase project is ACTIVE_HEALTHY on PostgreSQL 17.6.
- `public.notification_push_config` now has RLS enabled and no `anon`/`authenticated` table privileges.
- Newly-created functions in the public schema no longer receive client EXECUTE privileges by default; application RPCs retain explicit grants.
- All 113 SECURITY DEFINER functions in `public` have a pinned `search_path`.
- No SECURITY DEFINER function in `public` is executable by `anon`.
- 75 SECURITY DEFINER functions are executable by `authenticated`; these are existing application RPCs and must be reviewed by purpose rather than revoked blindly.
- The apparent `community_membership_is_active` exception is used by an RLS policy and therefore must not be revoked without replacing that policy dependency.
- RLS-enabled tables without policies are predominantly service/internal/auth/storage boundaries. They are not automatically vulnerabilities because denied-by-default RLS is still effective.

## Remaining security work
- Supabase Security Advisor still reports leaked-password protection as a warning. Enable leaked-password protection in Supabase Auth settings.
- Supabase reports multiple permissive-policy performance warnings. Review these table-by-table; do not merge policies blindly because some are intentionally separated by operation and role.
- Continue reviewing authenticated SECURITY DEFINER RPCs for least-privilege grants and explicit authorization checks.

## Secrets
Provider credentials belong in Supabase/Vercel/Cloudflare/GitHub secret stores, never in source. The database backup workflow requires `SUPABASE_DB_URL` and `BACKUP_ENCRYPTION_PASSPHRASE` in the production environment.