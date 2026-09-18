-- Economical backend control/reconciliation manifest.
-- Every structural action has a deterministic forward action_key and reverse_key.
-- The reverse key identifies the exact compensating operation; it does not silently
-- mutate production data. A rollback executor must explicitly approve/use it.

create table if not exists public.backend_change_registry (
  id uuid primary key default gen_random_uuid(),
  object_kind text not null check (object_kind in ('table','policy','function','trigger','index','grant','extension','constraint')),
  object_name text not null,
  action text not null,
  action_key text not null unique,
  reverse_action text not null,
  reverse_key text not null unique,
  migration_key text not null,
  checksum text,
  status text not null default 'active' check (status in ('active','reversed','superseded')),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists backend_change_registry_migration_idx
  on public.backend_change_registry(migration_key,created_at desc);
create index if not exists backend_change_registry_object_idx
  on public.backend_change_registry(object_kind,object_name);

alter table public.backend_change_registry enable row level security;

drop policy if exists backend_change_registry_service_only on public.backend_change_registry;
create policy backend_change_registry_service_only
  on public.backend_change_registry
  for all to service_role
  using (true)
  with check (true);

revoke all on public.backend_change_registry from anon, authenticated;
grant select,insert,update,delete on public.backend_change_registry to service_role;

insert into public.backend_change_registry
  (object_kind,object_name,action,action_key,reverse_action,reverse_key,migration_key,metadata)
values
('table','profiles','create',
 'table:profiles:create:v1','drop table',
 'table:profiles:drop:v1','20260918190000_economical_backend_baseline',
 '{"owner":"auth.users","plane":"supabase-text-metadata"}'),
('table','posts','create',
 'table:posts:create:v1','drop table',
 'table:posts:drop:v1','20260918190000_economical_backend_baseline',
 '{"plane":"supabase-text-metadata"}'),
('table','media_assets','create',
 'table:media_assets:create:v1','drop table',
 'table:media_assets:drop:v1','20260918190000_economical_backend_baseline',
 '{"media_plane":"cloudflare-r2","database_role":"metadata-only"}'),
('table','post_media','create',
 'table:post_media:create:v1','drop table',
 'table:post_media:drop:v1','20260918190000_economical_backend_baseline',
 '{"media_plane":"cloudflare-r2","database_role":"metadata-only"}'),
('table','follows','create',
 'table:follows:create:v1','drop table',
 'table:follows:drop:v1','20260918190000_economical_backend_baseline',
 '{"plane":"supabase-text-metadata"}'),
('table','post_reactions','create',
 'table:post_reactions:create:v1','drop table',
 'table:post_reactions:drop:v1','20260918190000_economical_backend_baseline',
 '{"plane":"supabase-text-metadata"}'),
('table','post_translations','create',
 'table:post_translations:create:v1','drop table',
 'table:post_translations:drop:v1','20260918190000_economical_backend_baseline',
 '{"plane":"supabase-text-metadata"}'),
('table','post_analytics','create',
 'table:post_analytics:create:v1','drop table',
 'table:post_analytics:drop:v1','20260918190000_economical_backend_baseline',
 '{"plane":"supabase-text-metadata"}'),
('table','notifications','create',
 'table:notifications:create:v1','drop table',
 'table:notifications:drop:v1','20260918190000_economical_backend_baseline',
 '{"plane":"supabase-text-metadata"}'),
('function','handle_new_user','create',
 'function:handle_new_user:create:v1','drop function',
 'function:handle_new_user:drop:v1','20260918190000_economical_backend_baseline',
 '{"security":"security_definer"}'),
('function','touch_updated_at','create',
 'function:touch_updated_at:create:v1','drop function',
 'function:touch_updated_at:drop:v1','20260918190000_economical_backend_baseline',
 '{"purpose":"updated_at"}'),
('trigger','on_auth_user_created','create',
 'trigger:on_auth_user_created:create:v1','drop trigger',
 'trigger:on_auth_user_created:drop:v1','20260918190000_economical_backend_baseline',
 '{}'),
('policy','profiles_owner_read','create',
 'policy:profiles_owner_read:create:v1','drop policy',
 'policy:profiles_owner_read:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"profiles","operation":"select"}'),
('policy','profiles_owner_insert','create',
 'policy:profiles_owner_insert:create:v1','drop policy',
 'policy:profiles_owner_insert:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"profiles","operation":"insert"}'),
('policy','profiles_owner_update','create',
 'policy:profiles_owner_update:create:v1','drop policy',
 'policy:profiles_owner_update:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"profiles","operation":"update"}'),
('policy','posts_owner_all','create',
 'policy:posts_owner_all:create:v1','drop policy',
 'policy:posts_owner_all:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"posts","operation":"all"}'),
('policy','media_owner_all','create',
 'policy:media_owner_all:create:v1','drop policy',
 'policy:media_owner_all:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"media_assets","operation":"all"}'),
('policy','post_media_owner_all','create',
 'policy:post_media_owner_all:create:v1','drop policy',
 'policy:post_media_owner_all:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"post_media","operation":"all"}'),
('policy','follows_owner_all','create',
 'policy:follows_owner_all:create:v1','drop policy',
 'policy:follows_owner_all:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"follows","operation":"all"}'),
('policy','reactions_owner_all','create',
 'policy:reactions_owner_all:create:v1','drop policy',
 'policy:reactions_owner_all:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"post_reactions","operation":"all"}'),
('policy','translations_read','create',
 'policy:translations_read:create:v1','drop policy',
 'policy:translations_read:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"post_translations","operation":"select"}'),
('policy','analytics_owner','create',
 'policy:analytics_owner:create:v1','drop policy',
 'policy:analytics_owner:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"post_analytics","operation":"all"}'),
('policy','notifications_owner_read','create',
 'policy:notifications_owner_read:create:v1','drop policy',
 'policy:notifications_owner_read:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"notifications","operation":"select"}'),
('policy','notifications_owner_update','create',
 'policy:notifications_owner_update:create:v1','drop policy',
 'policy:notifications_owner_update:drop:v1','20260918190000_economical_backend_baseline',
 '{"table":"notifications","operation":"update"}')
on conflict (action_key) do nothing;

-- Machine-readable invariant used by CI/reconstruction:
-- every active entry must have both keys and they must never be identical.
do $$
begin
  if exists (
    select 1 from public.backend_change_registry
    where status = 'active'
      and (action_key is null or reverse_key is null or action_key = reverse_key)
  ) then
    raise exception 'backend_change_registry contains an invalid action/reverse key pair';
  end if;
end $$;
