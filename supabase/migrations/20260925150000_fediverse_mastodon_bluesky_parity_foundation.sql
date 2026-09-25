create table if not exists public.fediverse_domain_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  created_at timestamptz not null default now(),
  unique(user_id, domain)
);
create index if not exists fediverse_domain_blocks_user_idx on public.fediverse_domain_blocks(user_id, domain);
alter table public.fediverse_domain_blocks enable row level security;
drop policy if exists "Users manage own fediverse domain blocks" on public.fediverse_domain_blocks;
create policy "Users manage own fediverse domain blocks" on public.fediverse_domain_blocks for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create table if not exists public.fediverse_content_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  phrase text not null check (char_length(trim(phrase)) between 1 and 200),
  contexts text[] not null default array['home','public','thread','notifications'],
  expires_at timestamptz,
  action text not null default 'warn' check (action in ('warn','hide')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fediverse_content_filters_user_idx on public.fediverse_content_filters(user_id, created_at desc);
alter table public.fediverse_content_filters enable row level security;
drop policy if exists "Users manage own fediverse content filters" on public.fediverse_content_filters;
create policy "Users manage own fediverse content filters" on public.fediverse_content_filters for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop trigger if exists fediverse_content_filters_updated_at on public.fediverse_content_filters;
create trigger fediverse_content_filters_updated_at before update on public.fediverse_content_filters for each row execute function public.set_updated_at();

create table if not exists public.fediverse_featured_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  unique(user_id, tag)
);
alter table public.fediverse_featured_tags enable row level security;
drop policy if exists "Users manage own fediverse featured tags" on public.fediverse_featured_tags;
create policy "Users manage own fediverse featured tags" on public.fediverse_featured_tags for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create table if not exists public.fediverse_profile_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);
create table if not exists public.fediverse_profile_collection_members (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.fediverse_profile_collections(id) on delete cascade,
  actor_uri text not null,
  display_name text,
  username text,
  avatar_url text,
  created_at timestamptz not null default now(),
  unique(collection_id, actor_uri)
);
alter table public.fediverse_profile_collections enable row level security;
alter table public.fediverse_profile_collection_members enable row level security;
drop policy if exists "Users manage own fediverse collections" on public.fediverse_profile_collections;
create policy "Users manage own fediverse collections" on public.fediverse_profile_collections for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "Users manage own fediverse collection members" on public.fediverse_profile_collection_members;
create policy "Users manage own fediverse collection members" on public.fediverse_profile_collection_members for all to authenticated using (exists(select 1 from public.fediverse_profile_collections c where c.id=collection_id and c.user_id=(select auth.uid()))) with check (exists(select 1 from public.fediverse_profile_collections c where c.id=collection_id and c.user_id=(select auth.uid())));

alter table public.profiles add column if not exists fediverse_quote_policy text not null default 'public';
do $$ begin
  alter table public.profiles add constraint profiles_fediverse_quote_policy_check check (fediverse_quote_policy in ('public','followers','nobody'));
exception when duplicate_object then null; end $$;
