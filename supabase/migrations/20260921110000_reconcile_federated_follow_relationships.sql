-- Reconcile the ActivityPub follow relationship store with the production schema.
-- The original federated_follow_relationships migration was stamped in history,
-- but the table was absent from the live database. Keep this migration idempotent
-- so production and fresh environments converge on the same contract.

create table if not exists public.federated_follow_relationships (
  id uuid primary key default gen_random_uuid(),
  local_user_id uuid not null references auth.users(id) on delete cascade,
  remote_actor_uri text not null,
  state text not null default 'pending'
    check (state in ('pending','accepted','active','removed','rejected','failed')),
  follow_activity_uri text,
  undo_activity_uri text,
  remote_inbox_uri text,
  delivery_state text default 'queued',
  delivery_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (local_user_id, remote_actor_uri)
);

alter table public.federated_follow_relationships enable row level security;

grant select on public.federated_follow_relationships to authenticated;

drop policy if exists "Users can read their federated follow relationships"
  on public.federated_follow_relationships;

create policy "Users can read their federated follow relationships"
on public.federated_follow_relationships
for select
to authenticated
using ((select auth.uid()) = local_user_id);

create index if not exists federated_follow_relationships_user_state_idx
  on public.federated_follow_relationships(local_user_id, state);

create index if not exists federated_follow_relationships_actor_idx
  on public.federated_follow_relationships(remote_actor_uri, state);

-- Recover follow state written by older builds so existing follows remain Following.
insert into public.federated_follow_relationships (
  local_user_id,
  remote_actor_uri,
  state,
  follow_activity_uri,
  remote_inbox_uri,
  created_at,
  updated_at
)
select
  local_user_id,
  remote_actor_uri,
  state,
  activity_id,
  remote_inbox_url,
  created_at,
  updated_at
from public.federated_relationships
where relationship = 'following'
  and state in ('pending','accepted','active')
on conflict (local_user_id, remote_actor_uri) do update
set
  state = excluded.state,
  follow_activity_uri = coalesce(
    public.federated_follow_relationships.follow_activity_uri,
    excluded.follow_activity_uri
  ),
  remote_inbox_uri = coalesce(
    public.federated_follow_relationships.remote_inbox_uri,
    excluded.remote_inbox_uri
  ),
  updated_at = excluded.updated_at;
