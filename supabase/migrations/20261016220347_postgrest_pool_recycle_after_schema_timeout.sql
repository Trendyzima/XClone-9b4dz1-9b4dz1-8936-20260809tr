-- The authenticator role's previous session timeout was too short for the production
-- PostgREST schema-cache query. Reassert the bounded per-database timeout and reload
-- PostgREST configuration before asking it to rebuild the schema cache.
ALTER ROLE authenticator IN DATABASE postgres SET statement_timeout = '30s';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
