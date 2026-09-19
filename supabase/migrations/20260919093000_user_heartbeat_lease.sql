create table if not exists public.user_heartbeat_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  client_version text,
  updated_at timestamptz not null default now()
);

alter table public.user_heartbeat_leases enable row level security;

drop policy if exists "heartbeat_select_own" on public.user_heartbeat_leases;
drop policy if exists "heartbeat_insert_own" on public.user_heartbeat_leases;
drop policy if exists "heartbeat_update_own" on public.user_heartbeat_leases;

create policy "heartbeat_select_own"
  on public.user_heartbeat_leases for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "heartbeat_insert_own"
  on public.user_heartbeat_leases for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "heartbeat_update_own"
  on public.user_heartbeat_leases for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists user_heartbeat_leases_expires_at_idx
  on public.user_heartbeat_leases (expires_at);

create or replace function public.touch_user_heartbeat(p_client_version text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  insert into public.user_heartbeat_leases(user_id,last_seen_at,expires_at,client_version,updated_at)
  values (
    v_user_id,
    v_now,
    v_now + interval '2 minutes',
    nullif(left(trim(coalesce(p_client_version,'')),40),''),
    v_now
  )
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at,
        expires_at = excluded.expires_at,
        client_version = excluded.client_version,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'last_seen_at', v_now,
    'expires_at', v_now + interval '2 minutes'
  );
end;
$$;

revoke all on function public.touch_user_heartbeat(text) from public;
grant execute on function public.touch_user_heartbeat(text) to authenticated;
