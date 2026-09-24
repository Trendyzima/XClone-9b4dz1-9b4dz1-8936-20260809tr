create table if not exists public.federated_discovery_impressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_id uuid not null references public.federated_objects(id) on delete cascade,
  surface text not null default 'home',
  shown_at timestamptz not null default now(),
  opened boolean not null default false,
  followed boolean not null default false,
  hidden boolean not null default false,
  reported boolean not null default false,
  unique (user_id, object_id, surface)
);

create index if not exists federated_discovery_impressions_user_surface_idx
  on public.federated_discovery_impressions(user_id, surface, shown_at desc);

alter table public.federated_discovery_impressions enable row level security;

drop policy if exists "federated_discovery_impressions_owner_select" on public.federated_discovery_impressions;
create policy "federated_discovery_impressions_owner_select"
on public.federated_discovery_impressions for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "federated_discovery_impressions_owner_insert" on public.federated_discovery_impressions;
create policy "federated_discovery_impressions_owner_insert"
on public.federated_discovery_impressions for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "federated_discovery_impressions_owner_update" on public.federated_discovery_impressions;
create policy "federated_discovery_impressions_owner_update"
on public.federated_discovery_impressions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on public.federated_discovery_impressions to authenticated;
