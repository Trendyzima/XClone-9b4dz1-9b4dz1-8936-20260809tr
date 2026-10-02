-- Repair Newsify worker locking: advisory locks cannot be acquired in one PostgREST
-- connection and released from another. Use a short lease row instead.
create table if not exists public.newsify_sync_leases (
  id smallint primary key check (id = 1),
  lease_until timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.newsify_sync_leases enable row level security;
revoke all on public.newsify_sync_leases from public, anon, authenticated;
grant select, insert, update, delete on public.newsify_sync_leases to service_role;

create or replace function public.newsify_sync_lock() returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return exists (
    with acquired as (
      insert into public.newsify_sync_leases(id, lease_until, updated_at)
      values (1, now() + interval '5 minutes', now())
      on conflict (id) do update
        set lease_until = excluded.lease_until,
            updated_at = excluded.updated_at
        where public.newsify_sync_leases.lease_until <= now()
      returning id
    )
    select 1 from acquired
  );
end;
$$;

create or replace function public.newsify_sync_unlock() returns boolean
language sql security definer set search_path=public,pg_temp as $$
  update public.newsify_sync_leases
     set lease_until=now(), updated_at=now()
   where id=1
  returning true;
$$;
revoke all on function public.newsify_sync_lock() from public, anon, authenticated;
revoke all on function public.newsify_sync_unlock() from public, anon, authenticated;
grant execute on function public.newsify_sync_lock() to service_role;
grant execute on function public.newsify_sync_unlock() to service_role;