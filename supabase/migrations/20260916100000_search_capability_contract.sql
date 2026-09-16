-- Canonical authenticated search capabilities.
-- Applied to the production Supabase project before this source-control record was added.

insert into public.capability_registry (name, version, access, readonly, enabled, description)
values
  ('testagram.search.hashtags', 1, 'authenticated', true, true, 'Search visible hashtags using native PostgREST/RLS access.'),
  ('testagram.search.communities', 1, 'authenticated', true, true, 'Search visible communities using native PostgREST/RLS access.')
on conflict (name) do update
set version = excluded.version,
    access = excluded.access,
    readonly = excluded.readonly,
    enabled = excluded.enabled,
    description = excluded.description,
    updated_at = now();

-- The authoritative capability_dispatch implementation is deployed by the
-- corresponding Supabase migration and routes all four search capabilities:
-- testagram.search.posts
-- testagram.search.users
-- testagram.search.hashtags
-- testagram.search.communities
--
-- Search is authenticated, SECURITY INVOKER, and runs against canonical
-- public tables under their RLS policies. Pagination uses the numeric cursor
-- convention already used by the capability client.