-- Staff PIN lifecycle + privileged-access email audit.
-- The staff account may initialize its own PIN once, change it with the current PIN,
-- or reset it only after a confirmation code delivered to the system security mailbox.

create table if not exists public.testagram_staff_pin_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.testagram_staff_pin_reset_requests enable row level security;
revoke all on public.testagram_staff_pin_reset_requests from anon, authenticated, public;

create or replace function public.testagram_queue_security_email(p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path=public, extensions, vault
as $$
declare
  v_secret text;
  v_signature text;
  v_body text;
  v_request_id bigint;
begin
  v_secret := (select decrypted_secret from vault.decrypted_secrets where name='staff_security_worker_token' limit 1);
  if v_secret is null or length(v_secret) < 32 then
    raise warning 'Staff security email secret is not configured';
    return null;
  end if;
  v_body := p_payload::text;
  v_signature := encode(hmac(v_body, v_secret, 'sha256'), 'hex');
  select net.http_post(
    url := 'https://ffrhglgkukgsuhxenena.supabase.co/functions/v1/testagram-security-email',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-testagram-security-signature',v_signature
    ),
    body := p_payload,
    timeout_milliseconds := 5000
  ) into v_request_id;
  return v_request_id;
exception when others then
  raise warning 'Unable to queue staff security email: %', SQLERRM;
  return null;
end
$$;

revoke all on function public.testagram_queue_security_email(jsonb) from public, anon, authenticated;

create or replace function public.testagram_security_audit_email_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor text;
  v_target text;
  v_payload jsonb;
begin
  if new.action = 'staff.workspace_pin.reset_requested' then
    return new;
  end if;

  select username into v_actor from public.profiles where id=new.actor_user_id;
  select username into v_target from public.profiles where id=new.target_user_id;

  v_payload := jsonb_build_object(
    'event_type','audit',
    'audit_id',new.id,
    'actor_username',coalesce(v_actor,'unknown'),
    'target_username',coalesce(v_target,v_actor,'unknown'),
    'action',new.action,
    'reason',new.reason,
    'created_at',new.created_at,
    'metadata',coalesce(new.metadata,'{}'::jsonb)
  );

  perform public.testagram_queue_security_email(v_payload);
  return new;
end
$$;

drop trigger if exists testagram_governance_audit_security_email on public.testagram_governance_audit_log;
create trigger testagram_governance_audit_security_email
after insert on public.testagram_governance_audit_log
for each row execute function public.testagram_security_audit_email_trigger();
revoke all on function public.testagram_security_audit_email_trigger() from public, anon, authenticated;

create or replace function public.testagram_set_staff_workspace_pin(p_user_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_username text;
  v_existing boolean;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits'; end if;

  select lower(username) into v_username from public.profiles where id=p_user_id;
  if v_username is null or v_username <> 'crissbeat' then
    raise exception 'This PIN is reserved for the authorized staff account';
  end if;

  select exists(select 1 from public.testagram_staff_workspace_pins where user_id=p_user_id) into v_existing;

  if not public.testagram_is_owner() and not (v_actor=p_user_id and not v_existing) then
    raise exception 'Only the system owner can initialize or replace an existing staff workspace PIN';
  end if;

  insert into public.testagram_staff_workspace_pins(user_id,pin_hash,failed_attempts,locked_until,updated_at)
  values(p_user_id,crypt(p_pin,gen_salt('bf',12)),0,null,now())
  on conflict(user_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,updated_at=now();

  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(v_actor,'staff.workspace_pin.set',p_user_id,
    case when v_existing then 'Owner replaced staff workspace PIN' else 'Staff initialized staff workspace PIN' end,
    jsonb_build_object('username',v_username,'existing_pin',v_existing));

  return jsonb_build_object('success',true,'pin_set',true,'initial',not v_existing);
end
$$;

create or replace function public.testagram_change_staff_workspace_pin(p_current_pin text, p_new_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  u uuid := auth.uid();
  v_username text;
  s public.testagram_staff_workspace_pins%rowtype;
begin
  if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select lower(username) into v_username from public.profiles where id=u;
  if v_username <> 'crissbeat' then raise exception 'Staff PIN change is not available for this account'; end if;
  if p_new_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits'; end if;

  select * into s from public.testagram_staff_workspace_pins where user_id=u for update;
  if s.user_id is null then raise exception 'PIN_NOT_SET'; end if;
  if s.locked_until is not null and s.locked_until>now() then raise exception 'PIN_LOCKED'; end if;
  if crypt(p_current_pin,s.pin_hash)<>s.pin_hash then
    update public.testagram_staff_workspace_pins set failed_attempts=failed_attempts+1,
      locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else null end,
      updated_at=now() where user_id=u;
    raise exception 'INVALID_CURRENT_PIN';
  end if;

  update public.testagram_staff_workspace_pins
    set pin_hash=crypt(p_new_pin,gen_salt('bf',12)),failed_attempts=0,locked_until=null,updated_at=now()
    where user_id=u;

  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(u,'staff.workspace_pin.changed',u,'Staff changed the workspace PIN',jsonb_build_object('username',v_username));
  return jsonb_build_object('success',true);
end
$$;

create or replace function public.testagram_request_staff_workspace_pin_reset()
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  u uuid := auth.uid();
  v_username text;
  v_code text;
  v_request_id uuid;
  v_expires timestamptz := now()+interval '10 minutes';
begin
  if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select lower(username) into v_username from public.profiles where id=u;
  if v_username <> 'crissbeat' then raise exception 'Staff PIN reset is not available for this account'; end if;

  v_code := lpad((floor(random()*1000000))::int::text,6,'0');
  v_request_id := gen_random_uuid();

  update public.testagram_staff_pin_reset_requests
    set used_at=coalesce(used_at,now())
    where user_id=u and used_at is null;

  insert into public.testagram_staff_pin_reset_requests(id,user_id,code_hash,expires_at)
  values(v_request_id,u,crypt(v_code,gen_salt('bf',12)),v_expires);

  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(u,'staff.workspace_pin.reset_requested',u,'Staff requested a workspace PIN reset',
    jsonb_build_object('request_id',v_request_id,'expires_at',v_expires));

  perform public.testagram_queue_security_email(jsonb_build_object(
    'event_type','staff_pin_reset_requested',
    'audit_id',v_request_id,
    'actor_username',v_username,
    'target_username',v_username,
    'action','staff.workspace_pin.reset_requested',
    'created_at',now(),
    'reset_code',v_code,
    'expires_at',v_expires
  ));

  return jsonb_build_object('success',true,'request_id',v_request_id,'expires_at',v_expires);
end
$$;

create or replace function public.testagram_confirm_staff_workspace_pin_reset(p_request_id uuid, p_code text, p_new_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  u uuid := auth.uid();
  v_username text;
  s public.testagram_staff_pin_reset_requests%rowtype;
begin
  if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select lower(username) into v_username from public.profiles where id=u;
  if v_username <> 'crissbeat' then raise exception 'Staff PIN reset is not available for this account'; end if;
  if p_code !~ '^[0-9]{6}$' then raise exception 'RESET_CODE_INVALID'; end if;
  if p_new_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits'; end if;

  select * into s from public.testagram_staff_pin_reset_requests
    where id=p_request_id and user_id=u for update;

  if s.id is null or s.used_at is not null or s.expires_at<=now() then
    raise exception 'RESET_CODE_EXPIRED';
  end if;

  if s.attempts>=5 then
    raise exception 'RESET_CODE_LOCKED';
  end if;

  if crypt(p_code,s.code_hash)<>s.code_hash then
    update public.testagram_staff_pin_reset_requests set attempts=attempts+1 where id=s.id;
    raise exception 'RESET_CODE_INVALID';
  end if;

  update public.testagram_staff_workspace_pins
    set pin_hash=crypt(p_new_pin,gen_salt('bf',12)),failed_attempts=0,locked_until=null,updated_at=now()
    where user_id=u;

  if not found then
    insert into public.testagram_staff_workspace_pins(user_id,pin_hash)
    values(u,crypt(p_new_pin,gen_salt('bf',12)));
  end if;

  update public.testagram_staff_pin_reset_requests set used_at=now() where id=s.id;

  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(u,'staff.workspace_pin.reset_confirmed',u,'Staff completed a security-mail-confirmed workspace PIN reset',
    jsonb_build_object('request_id',p_request_id));

  return jsonb_build_object('success',true);
end
$$;

revoke all on function public.testagram_change_staff_workspace_pin(text,text) from public,anon;
revoke all on function public.testagram_request_staff_workspace_pin_reset() from public,anon;
revoke all on function public.testagram_confirm_staff_workspace_pin_reset(uuid,text,text) from public,anon;
grant execute on function public.testagram_change_staff_workspace_pin(text,text) to authenticated;
grant execute on function public.testagram_request_staff_workspace_pin_reset() to authenticated;
grant execute on function public.testagram_confirm_staff_workspace_pin_reset(uuid,text,text) to authenticated;
