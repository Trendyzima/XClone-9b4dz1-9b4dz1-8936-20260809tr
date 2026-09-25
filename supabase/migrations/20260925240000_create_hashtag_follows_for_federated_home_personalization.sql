create table if not exists public.hashtag_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  hashtag_id uuid not null references public.hashtags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, hashtag_id)
);

create index if not exists hashtag_follows_hashtag_id_idx on public.hashtag_follows(hashtag_id);
create index if not exists hashtag_follows_user_id_idx on public.hashtag_follows(user_id);

alter table public.hashtag_follows enable row level security;

drop policy if exists "Users can view their hashtag follows" on public.hashtag_follows;
create policy "Users can view their hashtag follows"
on public.hashtag_follows for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can follow hashtags" on public.hashtag_follows;
create policy "Users can follow hashtags"
on public.hashtag_follows for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can unfollow hashtags" on public.hashtag_follows;
create policy "Users can unfollow hashtags"
on public.hashtag_follows for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.sync_hashtag_follower_count()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.hashtags
      set follower_count = coalesce(follower_count, 0) + 1
      where id = new.hashtag_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.hashtags
      set follower_count = greatest(coalesce(follower_count, 0) - 1, 0)
      where id = old.hashtag_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists hashtag_follows_count_trigger on public.hashtag_follows;
create trigger hashtag_follows_count_trigger
after insert or delete on public.hashtag_follows
for each row execute function public.sync_hashtag_follower_count();

grant select, insert, delete on public.hashtag_follows to authenticated;
