-- WhatsApp-style communications expansion: per-user chat controls, starred messages, and 24h status.
create table if not exists public.conversation_settings (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz,
  pinned_at timestamptz,
  muted_until timestamptz,
  disappearing_seconds integer check (disappearing_seconds is null or disappearing_seconds in (86400,604800,7776000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);
alter table public.conversation_settings enable row level security;
drop policy if exists conversation_settings_owner on public.conversation_settings;
create policy conversation_settings_owner on public.conversation_settings for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create table if not exists public.message_stars (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id,user_id)
);
alter table public.message_stars enable row level security;
drop policy if exists message_stars_owner on public.message_stars;
create policy message_stars_owner on public.message_stars for all to authenticated
using (user_id=(select auth.uid()) and exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=(select auth.uid()) and cm.left_at is null where m.id=message_stars.message_id))
with check (user_id=(select auth.uid()) and exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=(select auth.uid()) and cm.left_at is null where m.id=message_stars.message_id));

create table if not exists public.communication_statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_url text,
  media_type text not null default 'text' check (media_type in ('text','image','video')),
  caption text,
  background text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours')
);
alter table public.communication_statuses enable row level security;
drop policy if exists communication_statuses_select on public.communication_statuses;
create policy communication_statuses_select on public.communication_statuses for select to authenticated
using (expires_at > now() and (user_id=(select auth.uid()) or exists(select 1 from public.follows f where f.follower_id=(select auth.uid()) and f.following_id=communication_statuses.user_id)));
drop policy if exists communication_statuses_insert on public.communication_statuses;
create policy communication_statuses_insert on public.communication_statuses for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists communication_statuses_update on public.communication_statuses;
create policy communication_statuses_update on public.communication_statuses for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists communication_statuses_delete on public.communication_statuses;
create policy communication_statuses_delete on public.communication_statuses for delete to authenticated using (user_id=(select auth.uid()));

create table if not exists public.communication_status_views (
  status_id uuid not null references public.communication_statuses(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (status_id,viewer_id)
);
alter table public.communication_status_views enable row level security;
drop policy if exists communication_status_views_access on public.communication_status_views;
create policy communication_status_views_access on public.communication_status_views for all to authenticated
using (viewer_id=(select auth.uid()) or exists(select 1 from public.communication_statuses s where s.id=communication_status_views.status_id and s.user_id=(select auth.uid())))
with check (viewer_id=(select auth.uid()));

alter table public.conversations add column if not exists description text;
alter table public.conversations add column if not exists avatar_url text;
create index if not exists idx_conversation_settings_user_sort on public.conversation_settings(user_id,pinned_at desc,updated_at desc);
create index if not exists idx_message_stars_user on public.message_stars(user_id,created_at desc);
create index if not exists idx_statuses_user_expires on public.communication_statuses(user_id,expires_at desc);
create index if not exists idx_status_views_status on public.communication_status_views(status_id,viewed_at desc);
