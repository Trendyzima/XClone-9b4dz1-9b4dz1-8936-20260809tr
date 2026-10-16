-- PostgREST's schema-cache load is currently failing in production.
-- Evidence: function logs report PGRST002 ("Could not query the database for the schema cache")
-- and PostgreSQL cancels the schema metadata PARSE query with SQLSTATE 57014.
-- The authenticator role has an 8s statement_timeout, while pg_stat_statements
-- records this catalog query taking up to ~14.6s. Give schema-cache loading
-- sufficient headroom; keep the change scoped to this database and role.
alter role authenticator in database postgres set statement_timeout = '30s';

-- Ask PostgREST to rebuild the cache using the updated connection setting.
notify pgrst, 'reload schema';
