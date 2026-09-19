-- Economical heartbeat semantics:
-- A lease means "recently active", not "browser tab remains open".
-- The lease is intentionally longer than the client activity cadence so
-- transient backgrounding/network delays do not immediately mark a user stale.
create or replace function public.touch_user_heartbeat(p_client_version text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_client_version text := nullif(left(trim(coalesce(p_client_version, '')), 40), '');
  v_refreshed boolean := false;
  v_last_seen_at timestamptz;
  v_expires_at timestamptz;
  v_stored_client_version text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  update public.user_heartbeat_leases
     set last_seen_at = v_now,
         expires_at = v_now + interval '30 minutes',
         client_version = v_client_version,
         updated_at = v_now
   where user_id = v_user_id
     and expires_at <= v_now + interval '20 minutes';

  if found then
    v_refreshed := true;
  else
    insert into public.user_heartbeat_leases (
      user_id,
      last_seen_at,
      expires_at,
      client_version,
      updated_at
    )
    values (
      v_user_id,
      v_now,
      v_now + interval '30 minutes',
      v_client_version,
      v_now
    )
    on conflict (user_id) do nothing;

    if found then
      v_refreshed := true;
    end if;
  end if;

  select
    last_seen_at,
    expires_at,
    client_version
  into
    v_last_seen_at,
    v_expires_at,
    v_stored_client_version
  from public.user_heartbeat_leases
  where user_id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'refreshed', v_refreshed,
    'last_seen_at', v_last_seen_at,
    'expires_at', v_expires_at,
    'client_version', v_stored_client_version
  );
end;
$$;

revoke all on function public.touch_user_heartbeat(text) from public, anon;
grant execute on function public.touch_user_heartbeat(text) to authenticated;
grant execute on function public.touch_user_heartbeat(text) to service_role;
