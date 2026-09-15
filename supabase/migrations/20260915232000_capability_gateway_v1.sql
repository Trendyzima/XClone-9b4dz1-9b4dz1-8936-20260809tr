-- Testagram native capability-plane contract.
-- The registry is declarative; execution remains in the explicit Edge Function allowlist.
create table if not exists public.capability_registry (
  name text primary key,
  version integer not null default 1 check (version > 0),
  access text not null check (access in ('public','authenticated')),
  readonly boolean not null default true,
  enabled boolean not null default true,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.capability_registry(name, version, access, readonly, description) values
('testagram.capabilities.list',1,'public',true,'List capabilities available to the caller.'),
('testagram.health.read',1,'public',true,'Read service-plane health.'),
('testagram.posts.list',1,'authenticated',true,'Read the authenticated user-visible post timeline page.'),
('testagram.posts.create',1,'authenticated',false,'Create a native Testagram post.'),
('testagram.search.posts',1,'authenticated',true,'Search visible posts using native PostgREST/RLS access.'),
('testagram.search.users',1,'authenticated',true,'Search visible profiles using native PostgREST/RLS access.'),
('testagram.recommendations.generate',1,'authenticated',false,'Generate ranked recommendations for the authenticated user.'),
('testagram.notifications.rank',1,'authenticated',true,'Read ranked notifications for the authenticated user.')
on conflict (name) do update set
  version = excluded.version,
  access = excluded.access,
  readonly = excluded.readonly,
  description = excluded.description,
  enabled = true,
  updated_at = now();

alter table public.capability_registry enable row level security;
drop policy if exists capability_registry_public_read on public.capability_registry;
create policy capability_registry_public_read on public.capability_registry
  for select using (enabled = true);

revoke insert, update, delete on public.capability_registry from anon, authenticated;
grant select on public.capability_registry to anon, authenticated;

create or replace function public.list_capabilities()
returns table(name text, version integer, access text, readonly boolean, description text)
language sql
security invoker
set search_path = public
as $$
  select c.name, c.version, c.access, c.readonly, c.description
  from public.capability_registry c
  where c.enabled = true
  order by c.name;
$$;

revoke all on function public.list_capabilities() from public;
grant execute on function public.list_capabilities() to anon, authenticated;

create index if not exists capability_registry_enabled_idx
  on public.capability_registry(enabled, name);
