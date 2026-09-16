-- Complete the native search capability registry.
-- capability_dispatch already implements these read-only authenticated paths;
-- this migration makes the registry and frontend contract agree on the same surface.
insert into public.capability_registry(name, version, access, readonly, description) values
('testagram.search.hashtags',1,'authenticated',true,'Search visible hashtags using native PostgREST/RLS access.'),
('testagram.search.communities',1,'authenticated',true,'Search visible communities using native PostgREST/RLS access.')
on conflict (name) do update set
  version = excluded.version,
  access = excluded.access,
  readonly = excluded.readonly,
  description = excluded.description,
  enabled = true,
  updated_at = now();
