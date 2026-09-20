-- ActivityPub core identity, key storage and local inbox/outbox primitives.
create table if not exists public.activitypub_actors (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
  actor_id text not null unique, username text not null unique, domain text not null,
  inbox_url text not null, outbox_url text not null, followers_url text not null, following_url text not null,
  public_key_pem text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists activitypub_actors_domain_idx on public.activitypub_actors(domain);
create table if not exists public.activitypub_keys (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
  actor_id uuid references public.activitypub_actors(id) on delete cascade, key_id text not null unique,
  public_key_pem text not null, private_key_pem text not null, algorithm text not null default 'RSASSA-PKCS1-v1_5',
  key_size integer not null default 2048, created_at timestamptz not null default now(), rotated_at timestamptz
);
create table if not exists public.activitypub_inbox (
  id uuid primary key default gen_random_uuid(), local_user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null, actor_url text, object_url text, payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false, created_at timestamptz not null default now()
);
create index if not exists activitypub_inbox_user_created_idx on public.activitypub_inbox(local_user_id, created_at desc);
create table if not exists public.activitypub_outbox (
  id uuid primary key default gen_random_uuid(), local_user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null, activity_id text, payload jsonb not null default '{}'::jsonb,
  delivered boolean not null default false, created_at timestamptz not null default now()
);
create index if not exists activitypub_outbox_user_created_idx on public.activitypub_outbox(local_user_id, created_at desc);
create table if not exists public.federated_following (
  id uuid primary key default gen_random_uuid(), local_user_id uuid not null references auth.users(id) on delete cascade,
  remote_actor_url text not null, remote_username text, remote_domain text, created_at timestamptz not null default now(),
  unique(local_user_id, remote_actor_url)
);
alter table public.activitypub_actors enable row level security;
alter table public.activitypub_keys enable row level security;
alter table public.activitypub_inbox enable row level security;
alter table public.activitypub_outbox enable row level security;
alter table public.federated_following enable row level security;
drop policy if exists "activitypub actors own select" on public.activitypub_actors;
create policy "activitypub actors own select" on public.activitypub_actors for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "activitypub keys own select" on public.activitypub_keys;
create policy "activitypub keys own select" on public.activitypub_keys for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "activitypub inbox own select" on public.activitypub_inbox;
create policy "activitypub inbox own select" on public.activitypub_inbox for select to authenticated using ((select auth.uid()) = local_user_id);
drop policy if exists "activitypub inbox own update" on public.activitypub_inbox;
create policy "activitypub inbox own update" on public.activitypub_inbox for update to authenticated using ((select auth.uid()) = local_user_id) with check ((select auth.uid()) = local_user_id);
drop policy if exists "activitypub outbox own select" on public.activitypub_outbox;
create policy "activitypub outbox own select" on public.activitypub_outbox for select to authenticated using ((select auth.uid()) = local_user_id);
drop policy if exists "federated following own select" on public.federated_following;
create policy "federated following own select" on public.federated_following for select to authenticated using ((select auth.uid()) = local_user_id);
drop policy if exists "federated following own insert" on public.federated_following;
create policy "federated following own insert" on public.federated_following for insert to authenticated with check ((select auth.uid()) = local_user_id);
drop policy if exists "federated following own delete" on public.federated_following;
create policy "federated following own delete" on public.federated_following for delete to authenticated using ((select auth.uid()) = local_user_id);
revoke all on public.activitypub_keys from anon, authenticated;
grant select (id,user_id,actor_id,key_id,public_key_pem,algorithm,key_size,created_at,rotated_at) on public.activitypub_keys to authenticated;
grant select on public.activitypub_actors to authenticated;
grant select, update on public.activitypub_inbox to authenticated;
grant select on public.activitypub_outbox to authenticated;
grant select, insert, delete on public.federated_following to authenticated;