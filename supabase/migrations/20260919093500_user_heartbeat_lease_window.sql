create or replace function public.touch_user_heartbeat(p_client_version text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_user_id uuid := auth.uid(); v_now timestamptz := now();
begin
  if v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  insert into public.user_heartbeat_leases(user_id,last_seen_at,expires_at,client_version,updated_at)
  values(v_user_id,v_now,v_now+interval '10 minutes',nullif(left(trim(coalesce(p_client_version,'')),40),''),v_now)
  on conflict(user_id) do update set last_seen_at=excluded.last_seen_at,expires_at=excluded.expires_at,client_version=excluded.client_version,updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true,'last_seen_at',v_now,'expires_at',v_now+interval '10 minutes');
end;
$$;
revoke all on function public.touch_user_heartbeat(text) from public;
grant execute on function public.touch_user_heartbeat(text) to authenticated;