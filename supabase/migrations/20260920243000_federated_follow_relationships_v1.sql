-- Canonical ActivityPub follow/follower relationship store.
create table if not exists public.federated_relationships (
  id uuid primary key default gen_random_uuid(),
  local_user_id uuid not null references auth.users(id) on delete cascade,
  remote_actor_uri text not null,
  relationship text not null check (relationship in ('following','follower')),
  state text not null default 'pending' check (state in ('pending','accepted','active','rejected','failed','removed')),
  activity_id text,
  remote_inbox_url text,
  remote_shared_inbox_url text,
  remote_actor jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(local_user_id, remote_actor_uri, relationship)
);
create index if not exists federated_relationships_user_rel_idx on public.federated_relationships(local_user_id, relationship, state);
create index if not exists federated_relationships_remote_idx on public.federated_relationships(remote_actor_uri, relationship, state);
alter table public.federated_relationships enable row level security;
create policy "users read own federated relationships" on public.federated_relationships for select to authenticated using ((select auth.uid()) = local_user_id);
create policy "users manage own federated relationships" on public.federated_relationships for all to authenticated using ((select auth.uid()) = local_user_id) with check ((select auth.uid()) = local_user_id);
grant select, insert, update, delete on public.federated_relationships to authenticated;
