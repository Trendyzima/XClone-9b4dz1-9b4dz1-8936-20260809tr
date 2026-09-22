-- Meta-style Threads social conversation model.
-- Keep the existing public.threads table, but make it suitable for short-form conversations.

alter table public.threads
  add column if not exists media_urls jsonb not null default '[]'::jsonb,
  add column if not exists link_url text,
  add column if not exists reply_to_id uuid,
  add column if not exists root_thread_id uuid,
  add column if not exists likes_count integer not null default 0,
  add column if not exists reposts_count integer not null default 0,
  add column if not exists quotes_count integer not null default 0,
  add column if not exists replies_count integer not null default 0,
  add column if not exists views_count integer not null default 0;

alter table public.threads
  drop constraint if exists threads_reply_to_id_fkey,
  drop constraint if exists threads_root_thread_id_fkey;
alter table public.threads
  add constraint threads_reply_to_id_fkey foreign key (reply_to_id) references public.threads(id) on delete set null,
  add constraint threads_root_thread_id_fkey foreign key (root_thread_id) references public.threads(id) on delete set null;

create table if not exists public.thread_likes (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(thread_id,user_id)
);
create table if not exists public.thread_reposts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(thread_id,user_id)
);
create table if not exists public.thread_quotes (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now()
);
alter table public.thread_replies add column if not exists parent_reply_id uuid;
alter table public.thread_replies drop constraint if exists thread_replies_parent_reply_id_fkey;
alter table public.thread_replies add constraint thread_replies_parent_reply_id_fkey foreign key (parent_reply_id) references public.thread_replies(id) on delete cascade;
create table if not exists public.thread_bookmarks (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(thread_id,user_id)
);
create table if not exists public.thread_views (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  viewed_at timestamptz not null default now()
);

create index if not exists threads_feed_idx on public.threads (created_at desc) where deleted_at is null;
create index if not exists threads_owner_idx on public.threads (owner_id, created_at desc) where deleted_at is null;
create index if not exists threads_reply_idx on public.threads (reply_to_id, created_at asc) where deleted_at is null;
create index if not exists thread_likes_thread_idx on public.thread_likes (thread_id);
create index if not exists thread_likes_user_idx on public.thread_likes (user_id, thread_id);
create index if not exists thread_reposts_thread_idx on public.thread_reposts (thread_id);
create index if not exists thread_reposts_user_idx on public.thread_reposts (user_id, thread_id);
create index if not exists thread_quotes_thread_idx on public.thread_quotes (thread_id);
create index if not exists thread_bookmarks_user_idx on public.thread_bookmarks (user_id, created_at desc);
create index if not exists thread_bookmarks_thread_idx on public.thread_bookmarks (thread_id);
create index if not exists thread_views_thread_idx on public.thread_views (thread_id, viewed_at desc);

alter table public.threads enable row level security;
alter table public.thread_replies enable row level security;
alter table public.thread_likes enable row level security;
alter table public.thread_reposts enable row level security;
alter table public.thread_quotes enable row level security;
alter table public.thread_bookmarks enable row level security;
alter table public.thread_views enable row level security;

drop policy if exists "threads_public_read" on public.threads;
create policy "threads_public_read" on public.threads for select to anon, authenticated using (deleted_at is null and visibility='public');
drop policy if exists "threads_owner_insert" on public.threads;
create policy "threads_owner_insert" on public.threads for insert to authenticated with check (owner_id=(select auth.uid()));
drop policy if exists "threads_owner_update" on public.threads;
create policy "threads_owner_update" on public.threads for update to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
drop policy if exists "threads_owner_delete" on public.threads;
create policy "threads_owner_delete" on public.threads for delete to authenticated using (owner_id=(select auth.uid()));

drop policy if exists "thread_replies_public_read" on public.thread_replies;
create policy "thread_replies_public_read" on public.thread_replies for select to anon, authenticated using (exists(select 1 from public.threads t where t.id=thread_id and t.deleted_at is null and t.visibility='public'));
drop policy if exists "thread_replies_owner_insert" on public.thread_replies;
create policy "thread_replies_owner_insert" on public.thread_replies for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists "thread_replies_owner_update" on public.thread_replies;
create policy "thread_replies_owner_update" on public.thread_replies for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists "thread_replies_owner_delete" on public.thread_replies;
create policy "thread_replies_owner_delete" on public.thread_replies for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists "thread_likes_public_read" on public.thread_likes;
create policy "thread_likes_public_read" on public.thread_likes for select to anon, authenticated using (true);
drop policy if exists "thread_likes_owner_insert" on public.thread_likes;
create policy "thread_likes_owner_insert" on public.thread_likes for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists "thread_likes_owner_delete" on public.thread_likes;
create policy "thread_likes_owner_delete" on public.thread_likes for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists "thread_reposts_public_read" on public.thread_reposts;
create policy "thread_reposts_public_read" on public.thread_reposts for select to anon, authenticated using (true);
drop policy if exists "thread_reposts_owner_insert" on public.thread_reposts;
create policy "thread_reposts_owner_insert" on public.thread_reposts for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists "thread_reposts_owner_delete" on public.thread_reposts;
create policy "thread_reposts_owner_delete" on public.thread_reposts for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists "thread_quotes_public_read" on public.thread_quotes;
create policy "thread_quotes_public_read" on public.thread_quotes for select to anon, authenticated using (true);
drop policy if exists "thread_quotes_owner_insert" on public.thread_quotes;
create policy "thread_quotes_owner_insert" on public.thread_quotes for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists "thread_quotes_owner_update" on public.thread_quotes;
create policy "thread_quotes_owner_update" on public.thread_quotes for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists "thread_quotes_owner_delete" on public.thread_quotes;
create policy "thread_quotes_owner_delete" on public.thread_quotes for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists "thread_bookmarks_owner_all" on public.thread_bookmarks;
create policy "thread_bookmarks_owner_all" on public.thread_bookmarks for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists "thread_views_owner_read" on public.thread_views;
create policy "thread_views_owner_read" on public.thread_views for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists "thread_views_owner_insert" on public.thread_views;
create policy "thread_views_owner_insert" on public.thread_views for insert to authenticated with check (user_id=(select auth.uid()));

grant select on public.threads, public.thread_replies, public.thread_likes, public.thread_reposts, public.thread_quotes to anon, authenticated;
grant insert, update, delete on public.threads, public.thread_replies to authenticated;
grant insert, delete on public.thread_likes, public.thread_reposts to authenticated;
grant insert, update, delete on public.thread_quotes to authenticated;
grant select, insert, update, delete on public.thread_bookmarks to authenticated;
grant select, insert on public.thread_views to authenticated;

create or replace function public.testagram_record_thread_view(p_thread_id uuid)
returns integer language plpgsql security definer set search_path=public as $
declare v_count integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.threads where id=p_thread_id and deleted_at is null and visibility='public') then raise exception 'Thread not found'; end if;
 if not exists(select 1 from public.thread_views where thread_id=p_thread_id and user_id=auth.uid() and viewed_at>now()-interval '5 minutes') then
   insert into public.thread_views(thread_id,user_id) values(p_thread_id,auth.uid());
   update public.threads set views_count=views_count+1,updated_at=now() where id=p_thread_id;
 end if;
 select views_count into v_count from public.threads where id=p_thread_id;
 return coalesce(v_count,0);
end; $$;
revoke execute on function public.testagram_record_thread_view(uuid) from public, anon;\ngrant execute on function public.testagram_record_thread_view(uuid) to authenticated;

create schema if not exists private;
create or replace function private.thread_like_counter() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.threads set likes_count=greatest(0,likes_count+case when TG_OP='INSERT' then 1 else -1 end) where id=case when TG_OP='INSERT' then NEW.thread_id else OLD.thread_id end; return case when TG_OP='INSERT' then NEW else OLD end; end; $$;
create or replace function private.thread_repost_counter() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.threads set reposts_count=greatest(0,reposts_count+case when TG_OP='INSERT' then 1 else -1 end) where id=case when TG_OP='INSERT' then NEW.thread_id else OLD.thread_id end; return case when TG_OP='INSERT' then NEW else OLD end; end; $$;
create or replace function private.thread_quote_counter() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.threads set quotes_count=greatest(0,quotes_count+case when TG_OP='INSERT' then 1 else -1 end) where id=case when TG_OP='INSERT' then NEW.thread_id else OLD.thread_id end; return case when TG_OP='INSERT' then NEW else OLD end; end; $$;
create or replace function private.thread_reply_counter() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.threads set replies_count=greatest(0,replies_count+case when TG_OP='INSERT' then 1 else -1 end) where id=case when TG_OP='INSERT' then NEW.thread_id else OLD.thread_id end; return case when TG_OP='INSERT' then NEW else OLD end; end; $$;
drop trigger if exists thread_likes_counter on public.thread_likes;
create trigger thread_likes_counter after insert or delete on public.thread_likes for each row execute function private.thread_like_counter();
drop trigger if exists thread_reposts_counter on public.thread_reposts;
create trigger thread_reposts_counter after insert or delete on public.thread_reposts for each row execute function private.thread_repost_counter();
drop trigger if exists thread_quotes_counter on public.thread_quotes;
create trigger thread_quotes_counter after insert or delete on public.thread_quotes for each row execute function private.thread_quote_counter();
drop trigger if exists thread_replies_counter on public.thread_replies;
create trigger thread_replies_counter after insert or delete on public.thread_replies for each row execute function private.thread_reply_counter();
revoke execute on function private.thread_like_counter() from public, anon, authenticated;
revoke execute on function private.thread_repost_counter() from public, anon, authenticated;
revoke execute on function private.thread_quote_counter() from public, anon, authenticated;
revoke execute on function private.thread_reply_counter() from public, anon, authenticated;
