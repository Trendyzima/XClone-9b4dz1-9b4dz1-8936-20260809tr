create table if not exists public.thread_reply_likes (
  id uuid primary key default gen_random_uuid(),
  reply_id uuid not null references public.thread_replies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint thread_reply_likes_unique unique (reply_id,user_id)
);
alter table public.thread_reply_likes enable row level security;
drop policy if exists thread_reply_likes_public_read on public.thread_reply_likes;
create policy thread_reply_likes_public_read on public.thread_reply_likes for select using (exists (select 1 from public.thread_replies r join public.threads t on t.id=r.thread_id where r.id=thread_reply_likes.reply_id and t.deleted_at is null and t.visibility='public'));
drop policy if exists thread_reply_likes_owner_insert on public.thread_reply_likes;
create policy thread_reply_likes_owner_insert on public.thread_reply_likes for insert to authenticated with check (user_id=(select auth.uid()) and exists (select 1 from public.thread_replies r join public.threads t on t.id=r.thread_id where r.id=thread_reply_likes.reply_id and t.deleted_at is null and t.visibility='public'));
drop policy if exists thread_reply_likes_owner_delete on public.thread_reply_likes;
create policy thread_reply_likes_owner_delete on public.thread_reply_likes for delete to authenticated using (user_id=(select auth.uid()));
create index if not exists thread_reply_likes_reply_created_idx on public.thread_reply_likes(reply_id,created_at desc);