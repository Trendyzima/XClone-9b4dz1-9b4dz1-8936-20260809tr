-- PIN-gated Staff Workspace access for the designated staff account.
create table if not exists public.testagram_staff_workspace_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.testagram_staff_workspace_pins enable row level security;
revoke all on public.testagram_staff_workspace_pins from anon, authenticated, public;

create or replace function public.testagram_set_staff_workspace_pin(p_user_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_username text;
begin
  if not public.testagram_is_owner() then raise exception 'Only the system owner can set staff workspace PINs'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits'; end if;
  select lower(username) into v_username from public.profiles where id=p_user_id;
  if v_username is null or v_username <> 'crissbeat' then raise exception 'This PIN is reserved for the authorized staff account'; end if;
  insert into public.testagram_staff_workspace_pins(user_id,pin_hash,failed_attempts,locked_until,updated_at)
  values(p_user_id,crypt(p_pin,gen_salt('bf',12)),0,null,now())
  on conflict(user_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,updated_at=now();
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(auth.uid(),'staff.workspace_pin.set',p_user_id,'Owner configured staff workspace PIN',jsonb_build_object('username',v_username));
  return jsonb_build_object('success',true,'pin_set',true);
end $$;

create or replace function public.testagram_verify_staff_workspace_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); v_username text; s public.testagram_staff_workspace_pins%rowtype; n integer;
begin
  if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select lower(username) into v_username from public.profiles where id=u;
  if v_username <> 'crissbeat' then return jsonb_build_object('success',false,'code','PIN_NOT_AVAILABLE'); end if;
  select * into s from public.testagram_staff_workspace_pins where user_id=u for update;
  if s.user_id is null then return jsonb_build_object('success',false,'code','PIN_NOT_SET'); end if;
  if s.locked_until is not null and s.locked_until>now() then return jsonb_build_object('success',false,'code','PIN_LOCKED','retry_at',s.locked_until); end if;
  if crypt(p_pin,s.pin_hash)=s.pin_hash then
    update public.testagram_staff_workspace_pins set failed_attempts=0,locked_until=null,updated_at=now() where user_id=u;
    insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason) values(u,'staff.workspace.unlocked',u,'Staff workspace PIN verified');
    return jsonb_build_object('success',true);
  end if;
  n:=coalesce(s.failed_attempts,0)+1;
  update public.testagram_staff_workspace_pins set failed_attempts=n,locked_until=case when n>=5 then now()+interval '15 minutes' else null end,updated_at=now() where user_id=u;
  return jsonb_build_object('success',false,'code',case when n>=5 then 'PIN_LOCKED' else 'INVALID_PIN' end,'attempts_remaining',greatest(0,5-n));
end $$;

revoke all on function public.testagram_set_staff_workspace_pin(uuid,text) from public,anon;
revoke all on function public.testagram_verify_staff_workspace_pin(text) from public,anon;
grant execute on function public.testagram_set_staff_workspace_pin(uuid,text) to authenticated;
grant execute on function public.testagram_verify_staff_workspace_pin(text) to authenticated;
