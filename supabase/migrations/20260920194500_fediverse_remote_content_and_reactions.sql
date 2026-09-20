-- Complete Fediverse cache, remote reactions and federation primitives.
create table if not exists public.federated_instances (
 id uuid primary key default gen_random_uuid(), domain text not null unique, base_url text not null, provider text,
 last_fetched_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.federated_actors (
 id uuid primary key default gen_random_uuid(), actor_uri text not null unique, username text not null, domain text not null,
 display_name text, bio text, avatar_url text, inbox_url text, outbox_url text, followers_url text, following_url text,
 public_key_pem text, raw_actor jsonb not null default '{}'::jsonb, fetched_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists federated_actors_handle_idx on public.federated_actors(username,domain);
create table if not exists public.federated_objects (
 id uuid primary key default gen_random_uuid(), uri text not null unique, object_type text not null default 'Note',
 actor_uri text, instance_id uuid references public.federated_instances(id) on delete set null, url text,
 content text not null default '', summary text, published_at timestamptz, updated_at timestamptz, sensitive boolean not null default false,
 in_reply_to_uri text, quote_uri text, language_code text, attachments jsonb not null default '[]'::jsonb, tags jsonb not null default '[]'::jsonb,
 like_count bigint not null default 0, announce_count bigint not null default 0, reply_count bigint not null default 0, quote_count bigint not null default 0,
 view_count bigint not null default 0, content_warning text, raw_object jsonb not null default '{}'::jsonb, tombstone boolean not null default false,
 deleted_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists federated_objects_published_idx on public.federated_objects(published_at desc);
create index if not exists federated_objects_actor_idx on public.federated_objects(actor_uri);
create table if not exists public.federated_reactions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 object_id uuid references public.federated_objects(id) on delete cascade, object_uri text not null,
 reaction_type text not null check (reaction_type in ('like','boost','reply')), content text, remote_activity_id text,
 delivered boolean not null default false, delivery_error text, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(user_id,object_uri,reaction_type)
);
create index if not exists federated_reactions_object_idx on public.federated_reactions(object_uri);
alter table public.federated_instances enable row level security;
alter table public.federated_actors enable row level security;
alter table public.federated_objects enable row level security;
alter table public.federated_reactions enable row level security;
drop policy if exists "federated instances public read" on public.federated_instances;
create policy "federated instances public read" on public.federated_instances for select to anon,authenticated using (true);
drop policy if exists "federated actors public read" on public.federated_actors;
create policy "federated actors public read" on public.federated_actors for select to anon,authenticated using (true);
drop policy if exists "federated objects public read" on public.federated_objects;
create policy "federated objects public read" on public.federated_objects for select to anon,authenticated using (deleted_at is null and tombstone=false);
drop policy if exists "federated reactions own read" on public.federated_reactions;
create policy "federated reactions own read" on public.federated_reactions for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "federated reactions own insert" on public.federated_reactions;
create policy "federated reactions own insert" on public.federated_reactions for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "federated reactions own update" on public.federated_reactions;
create policy "federated reactions own update" on public.federated_reactions for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "federated reactions own delete" on public.federated_reactions;
create policy "federated reactions own delete" on public.federated_reactions for delete to authenticated using ((select auth.uid())=user_id);
grant select on public.federated_instances, public.federated_actors, public.federated_objects to anon,authenticated;
grant select,insert,update,delete on public.federated_reactions to authenticated;