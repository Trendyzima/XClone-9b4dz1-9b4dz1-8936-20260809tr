-- Infinite Threads: first-class nested posts, media on replies and quotes, and parent counters.

alter table public.threads
  add column if not exists media_urls jsonb not null default '[]'::jsonb;

alter table public.thread_replies
  add column if not exists media_urls jsonb not null default '[]'::jsonb;

alter table public.thread_quotes
  add column if not exists media_urls jsonb not null default '[]'::jsonb;

create index if not exists threads_root_created_idx
  on public.threads (root_thread_id, created_at asc)
  where deleted_at is null;

create or replace function private.thread_child_counter()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if TG_OP='INSERT' and NEW.reply_to_id is not null then
    update public.threads set replies_count=greatest(0,replies_count+1),updated_at=now() where id=NEW.reply_to_id;
  elsif TG_OP='DELETE' and OLD.reply_to_id is not null then
    update public.threads set replies_count=greatest(0,replies_count-1),updated_at=now() where id=OLD.reply_to_id;
  end if;
  return case when TG_OP='INSERT' then NEW else OLD end;
end;
$$;

drop trigger if exists threads_child_counter on public.threads;
create trigger threads_child_counter after insert or delete on public.threads for each row execute function private.thread_child_counter();
revoke execute on function private.thread_child_counter() from public, anon, authenticated;

create or replace function public.testagram_record_thread_view(p_thread_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
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
end;
$$;

revoke execute on function public.testagram_record_thread_view(uuid) from public, anon;
grant execute on function public.testagram_record_thread_view(uuid) to authenticated;
