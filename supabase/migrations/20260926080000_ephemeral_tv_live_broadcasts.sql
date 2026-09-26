-- Ephemeral Testagram TV broadcast metadata.
-- IMPORTANT: this table stores broadcast state/metadata only. No video/audio blobs are persisted here.
create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'general',
  stream_url text,
  thumbnail_url text,
  is_live boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  viewer_count integer not null default 0 check (viewer_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists live_streams_live_idx on public.live_streams(is_live, started_at desc);
create index if not exists live_streams_user_idx on public.live_streams(user_id, created_at desc);

alter table public.live_streams enable row level security;

drop policy if exists "live_streams_public_read" on public.live_streams;
create policy "live_streams_public_read"
on public.live_streams for select
to anon, authenticated
using (is_live = true or auth.uid() = user_id);

drop policy if exists "live_streams_owner_insert" on public.live_streams;
create policy "live_streams_owner_insert"
on public.live_streams for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "live_streams_owner_update" on public.live_streams;
create policy "live_streams_owner_update"
on public.live_streams for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "live_streams_owner_delete" on public.live_streams;
create policy "live_streams_owner_delete"
on public.live_streams for delete
to authenticated
using (auth.uid() = user_id);

grant select on public.live_streams to anon, authenticated;
grant insert, update, delete on public.live_streams to authenticated;

create table if not exists public.stream_viewers (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists stream_viewers_stream_idx on public.stream_viewers(stream_id, last_seen_at desc);
create unique index if not exists stream_viewers_user_unique on public.stream_viewers(stream_id, user_id) where user_id is not null;
alter table public.stream_viewers enable row level security;

drop policy if exists "stream_viewers_public_read" on public.stream_viewers;
create policy "stream_viewers_public_read" on public.stream_viewers for select to anon, authenticated using (exists (select 1 from public.live_streams s where s.id=stream_id and s.is_live=true));
drop policy if exists "stream_viewers_authenticated_write" on public.stream_viewers;
create policy "stream_viewers_authenticated_write" on public.stream_viewers for insert to authenticated with check (auth.uid()=user_id and exists (select 1 from public.live_streams s where s.id=stream_id and s.is_live=true));
drop policy if exists "stream_viewers_authenticated_delete" on public.stream_viewers;
create policy "stream_viewers_authenticated_delete" on public.stream_viewers for delete to authenticated using (auth.uid()=user_id);
grant select on public.stream_viewers to anon, authenticated;
grant insert, delete on public.stream_viewers to authenticated;

create table if not exists public.stream_chat (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  message text not null check (char_length(message) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists stream_chat_stream_created_idx on public.stream_chat(stream_id, created_at desc);
alter table public.stream_chat enable row level security;

drop policy if exists "stream_chat_public_read" on public.stream_chat;
create policy "stream_chat_public_read" on public.stream_chat for select to anon, authenticated using (exists (select 1 from public.live_streams s where s.id=stream_id and s.is_live=true));
drop policy if exists "stream_chat_authenticated_insert" on public.stream_chat;
create policy "stream_chat_authenticated_insert" on public.stream_chat for insert to authenticated with check (auth.uid()=user_id and exists (select 1 from public.live_streams s where s.id=stream_id and s.is_live=true));
grant select on public.stream_chat to anon, authenticated;
grant insert on public.stream_chat to authenticated;

alter table public.live_streams replica identity full;
alter table public.stream_viewers replica identity full;
notify pgrst, 'reload schema';