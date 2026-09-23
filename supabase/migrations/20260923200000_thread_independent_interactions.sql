create table if not exists public.thread_quote_likes (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.thread_quotes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint thread_quote_likes_unique unique (quote_id,user_id)
);
alter table public.thread_quote_likes enable row level security;
drop policy if exists thread_quote_likes_public_read on public.thread_quote_likes;
create policy thread_quote_likes_public_read on public.thread_quote_likes for select using (
  exists (
    select 1 from public.thread_quotes q
    join public.threads t on t.id=q.thread_id
    where q.id=thread_quote_likes.quote_id and t.deleted_at is null and t.visibility='public'
  )
);
drop policy if exists thread_quote_likes_owner_insert on public.thread_quote_likes;
create policy thread_quote_likes_owner_insert on public.thread_quote_likes for insert to authenticated
with check (
  user_id=(select auth.uid()) and exists (
    select 1 from public.thread_quotes q
    join public.threads t on t.id=q.thread_id
    where q.id=thread_quote_likes.quote_id and t.deleted_at is null and t.visibility='public'
  )
);
drop policy if exists thread_quote_likes_owner_delete on public.thread_quote_likes;
create policy thread_quote_likes_owner_delete on public.thread_quote_likes for delete to authenticated
using (user_id=(select auth.uid()));
create index if not exists thread_quote_likes_quote_created_idx on public.thread_quote_likes(quote_id,created_at desc);
