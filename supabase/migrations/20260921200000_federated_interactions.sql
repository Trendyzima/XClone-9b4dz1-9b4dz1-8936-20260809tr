create table if not exists public.federated_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_uri text not null,
  interaction_type text not null check (interaction_type in ('like','repost')),
  active boolean not null default false,
  activity_uri text,
  remote_actor_uri text,
  delivery_state text,
  updated_at timestamptz not null default now(),
  unique(user_id, object_uri, interaction_type)
);

alter table public.federated_interactions enable row level security;

drop policy if exists "Users manage own federated interactions" on public.federated_interactions;
create policy "Users manage own federated interactions"
on public.federated_interactions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index if not exists federated_interactions_user_object_idx
on public.federated_interactions(user_id, object_uri);
