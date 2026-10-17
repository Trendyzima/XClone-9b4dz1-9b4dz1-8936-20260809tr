-- Emergency headroom for the PostgREST schema-cache query, which continues to hit
-- statement_timeout at 60s while the database is under pressure. This is bounded at
-- 120s to permit one full catalog load; it does not disable timeouts.
ALTER ROLE authenticator IN DATABASE postgres SET statement_timeout = '120s';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
