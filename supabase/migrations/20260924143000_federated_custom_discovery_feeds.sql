create table if not exists public.federated_custom_discovery_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text,
  query text not null default '',
  mode text not null default 'all' check (mode in ('all','people','posts','hashtags','mentions','media','conversations')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);
create index if not exists federated_custom_discovery_feeds_user_idx on public.federated_custom_discovery_feeds(user_id, updated_at desc);
alter table public.federated_custom_discovery_feeds enable row level security;
drop policy if exists "Users manage own federated discovery feeds" on public.federated_custom_discovery_feeds;
create policy "Users manage own federated discovery feeds" on public.federated_custom_discovery_feeds for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop trigger if exists federated_custom_discovery_feeds_updated_at on public.federated_custom_discovery_feeds;
create trigger federated_custom_discovery_feeds_updated_at before update on public.federated_custom_discovery_feeds for each row execute function public.set_updated_at();