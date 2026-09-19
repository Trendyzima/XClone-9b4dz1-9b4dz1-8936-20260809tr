create schema if not exists private;

create table if not exists private.daily_content_creation_limits (
  user_id uuid not null,
  quota_date date not null,
  creation_count integer not null default 0 check (creation_count >= 0 and creation_count <= 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, quota_date)
);

revoke all on schema private from public, anon, authenticated;
revoke all on private.daily_content_creation_limits from public, anon, authenticated;

create or replace function private.enforce_daily_content_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := auth.uid();
  owner_id uuid;
  today date := (now() at time zone 'utc')::date;
  existing_count integer;
  new_count integer;
begin
  if actor_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if tg_table_name = 'posts' then
    owner_id := new.user_id;
  else
    owner_id := new.owner_id;
  end if;

  if owner_id is null or owner_id <> actor_id then
    raise exception 'NOT_OWNER' using errcode = '42501';
  end if;

  insert into private.daily_content_creation_limits (user_id, quota_date, creation_count)
  values (
    actor_id,
    today,
    least(
      10,
      (select count(*)::integer
       from public.posts p
       where p.user_id = actor_id
         and (p.created_at at time zone 'utc')::date = today)
      +
      (select count(*)::integer
       from public.threads t
       where t.owner_id = actor_id
         and (t.created_at at time zone 'utc')::date = today)
    )
  )
  on conflict (user_id, quota_date) do nothing;

  update private.daily_content_creation_limits
     set creation_count = creation_count + 1,
         updated_at = now()
   where user_id = actor_id
     and quota_date = today
     and creation_count < 10
  returning creation_count into new_count;

  if new_count is null then
    select creation_count
      into existing_count
      from private.daily_content_creation_limits
     where user_id = actor_id
       and quota_date = today;

    raise exception 'DAILY_CREATION_LIMIT_REACHED'
      using errcode = 'P0001',
            detail = format(
              'Daily post/thread limit is 10. Used: %s. Remaining: 0.',
              coalesce(existing_count, 10)
            );
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_daily_content_creation_limit()
  from public, anon, authenticated;

drop trigger if exists enforce_daily_post_limit on public.posts;
create trigger enforce_daily_post_limit
before insert on public.posts
for each row execute function private.enforce_daily_content_creation_limit();

drop trigger if exists enforce_daily_thread_limit on public.threads;
create trigger enforce_daily_thread_limit
before insert on public.threads
for each row execute function private.enforce_daily_content_creation_limit();
