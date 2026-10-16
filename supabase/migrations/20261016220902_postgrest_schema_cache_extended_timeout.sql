-- Production PostgREST catalog introspection is still being cancelled at the 30-second
-- authenticator timeout while rebuilding the schema cache. Give this one-time cache
-- recovery enough headroom; keep the timeout finite and explicitly reload configuration.
ALTER ROLE authenticator IN DATABASE postgres SET statement_timeout = '60s';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
