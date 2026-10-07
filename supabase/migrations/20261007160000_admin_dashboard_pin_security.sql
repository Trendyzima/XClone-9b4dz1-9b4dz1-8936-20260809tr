create table if not exists public.testagram_admin_dashboard_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.testagram_admin_dashboard_pins enable row level security;
revoke all on public.testagram_admin_dashboard_pins from public,anon,authenticated;

create or replace function public.testagram_verify_admin_dashboard_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); g jsonb; s public.testagram_admin_dashboard_pins%rowtype;
begin
 if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
 g:=public.testagram_get_governance();
 if coalesce((g->>'is_admin')::boolean,false)=false or coalesce((g->>'is_owner')::boolean,false)=true then raise exception 'ADMIN_DASHBOARD_PIN_NOT_APPLICABLE'; end if;
 select * into s from public.testagram_admin_dashboard_pins where user_id=u for update;
 if s.user_id is null then return jsonb_build_object('success',false,'code','PIN_NOT_SET'); end if;
 if s.locked_until is not null and s.locked_until>now() then return jsonb_build_object('success',false,'code','PIN_LOCKED','locked_until',s.locked_until); end if;
 if p_pin is null or p_pin !~ '^[0-9]{4,6}$' or crypt(p_pin,s.pin_hash)<>s.pin_hash then
   update public.testagram_admin_dashboard_pins set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else null end,updated_at=now() where user_id=u;
   return jsonb_build_object('success',false,'code','INVALID_PIN','attempts_remaining',greatest(0,4-s.failed_attempts));
 end if;
 update public.testagram_admin_dashboard_pins set failed_attempts=0,locked_until=null,updated_at=now() where user_id=u;
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
 values(u,'admin.dashboard_pin.unlocked',u,'Appointed administrator unlocked the administration dashboard',jsonb_build_object('security_control','admin_dashboard_pin'));
 return jsonb_build_object('success',true);
end $$;
create or replace function public.testagram_set_admin_dashboard_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); g jsonb;
begin
 if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
 g:=public.testagram_get_governance();
 if coalesce((g->>'is_admin')::boolean,false)=false or coalesce((g->>'is_owner')::boolean,false)=true then raise exception 'ADMIN_DASHBOARD_PIN_NOT_APPLICABLE'; end if;
 if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits'; end if;
 insert into public.testagram_admin_dashboard_pins(user_id,pin_hash) values(u,crypt(p_pin,gen_salt('bf',12)))
 on conflict(user_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,updated_at=now();
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
 values(u,'admin.dashboard_pin.set',u,'Appointed administrator set administration dashboard PIN',jsonb_build_object('security_control','admin_dashboard_pin'));
 return jsonb_build_object('success',true);
end $$;
create or replace function public.testagram_change_admin_dashboard_pin(p_current_pin text,p_new_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); s public.testagram_admin_dashboard_pins%rowtype; g jsonb;
begin
 g:=public.testagram_get_governance();
 if u is null or coalesce((g->>'is_admin')::boolean,false)=false or coalesce((g->>'is_owner')::boolean,false)=true then raise exception 'ADMIN_DASHBOARD_PIN_NOT_APPLICABLE'; end if;
 if p_new_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must contain 4 to 6 digits'; end if;
 select * into s from public.testagram_admin_dashboard_pins where user_id=u for update;
 if s.user_id is null then raise exception 'PIN_NOT_SET'; end if;
 if s.locked_until is not null and s.locked_until>now() then raise exception 'PIN_LOCKED'; end if;
 if crypt(p_current_pin,s.pin_hash)<>s.pin_hash then
   update public.testagram_admin_dashboard_pins set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else null end,updated_at=now() where user_id=u;
   raise exception 'INVALID_CURRENT_PIN';
 end if;
 update public.testagram_admin_dashboard_pins set pin_hash=crypt(p_new_pin,gen_salt('bf',12)),failed_attempts=0,locked_until=null,updated_at=now() where user_id=u;
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
 values(u,'admin.dashboard_pin.changed',u,'Appointed administrator changed administration dashboard PIN',jsonb_build_object('security_control','admin_dashboard_pin'));
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.testagram_verify_admin_dashboard_pin(text) from public,anon;
revoke all on function public.testagram_set_admin_dashboard_pin(text) from public,anon;
revoke all on function public.testagram_change_admin_dashboard_pin(text,text) from public,anon;
grant execute on function public.testagram_verify_admin_dashboard_pin(text) to authenticated;
grant execute on function public.testagram_set_admin_dashboard_pin(text) to authenticated;
grant execute on function public.testagram_change_admin_dashboard_pin(text,text) to authenticated;