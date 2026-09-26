-- Require an AAL2/MFA-authenticated owner session for privileged governance mutations.
create or replace function public.testagram_require_privileged_session()
returns void language plpgsql stable security definer set search_path=''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if coalesce((select auth.jwt()->>'aal'),'aal1') <> 'aal2' then
    raise exception 'MFA verification is required for privileged governance changes';
  end if;
end;
$$;

create or replace function public.testagram_get_governance_for_user(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.testagram_is_owner() and p_user_id <> (select auth.uid()) then
    raise exception 'Governance status is only visible to the account owner or the system owner';
  end if;
  return jsonb_build_object(
    'is_owner', exists(select 1 from public.testagram_governance_owner o where o.singleton=true and o.user_id=p_user_id),
    'is_admin', exists(select 1 from public.testagram_governance_owner o where o.singleton=true and o.user_id=p_user_id)
      or exists(select 1 from public.testagram_governance_admin_assignments a where a.user_id=p_user_id and a.status='active'),
    'role', case when exists(select 1 from public.testagram_governance_owner o where o.singleton=true and o.user_id=p_user_id) then 'owner'
      else (select r.name from public.testagram_governance_admin_assignments a join public.testagram_governance_roles r on r.id=a.role_id where a.user_id=p_user_id and a.status='active' limit 1) end
  );
end;
$$;

create or replace function public.testagram_appoint_admin(p_user_id uuid,p_role_name text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_role_id uuid;
begin
  if not public.testagram_is_owner() then raise exception 'Only the Testagram system owner can appoint administrators'; end if;
  perform public.testagram_require_privileged_session();
  if p_user_id=(select auth.uid()) then raise exception 'The owner account does not need an administrator assignment'; end if;
  select id into v_role_id from public.testagram_governance_roles where name=p_role_name and is_system_role=true;
  if v_role_id is null then raise exception 'Unknown governance role'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'User does not exist'; end if;
  insert into public.testagram_governance_admin_assignments(user_id,role_id,status,appointed_by,revoked_at)
  values(p_user_id,v_role_id,'active',(select auth.uid()),null)
  on conflict(user_id) do update set role_id=excluded.role_id,status='active',appointed_by=excluded.appointed_by,updated_at=now(),revoked_at=null;
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason)
  values((select auth.uid()),'admin.appointed',p_user_id,p_role_name,'Owner appointment');
  return public.testagram_get_governance_for_user(p_user_id);
end;
$$;

create or replace function public.testagram_update_admin(p_user_id uuid,p_role_name text,p_status text default 'active',p_reason text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_role_id uuid;
begin
  if not public.testagram_is_owner() then raise exception 'Only the Testagram system owner can manage administrators'; end if;
  perform public.testagram_require_privileged_session();
  if p_user_id=(select auth.uid()) then raise exception 'The owner cannot be changed through administrator assignment'; end if;
  if p_status not in('active','suspended','revoked') then raise exception 'Invalid administrator status'; end if;
  select id into v_role_id from public.testagram_governance_roles where name=p_role_name;
  if v_role_id is null then raise exception 'Unknown governance role'; end if;
  update public.testagram_governance_admin_assignments
  set role_id=v_role_id,status=p_status,updated_at=now(),revoked_at=case when p_status='revoked' then now() else null end
  where user_id=p_user_id;
  if not found then raise exception 'Administrator assignment not found'; end if;
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason)
  values((select auth.uid()),case when p_status='revoked' then 'admin.revoked' when p_status='suspended' then 'admin.suspended' else 'admin.updated' end,p_user_id,p_role_name,coalesce(p_reason,'Owner governance change'));
  return public.testagram_get_governance_for_user(p_user_id);
end;
$$;

revoke all on function public.testagram_require_privileged_session() from public,anon;
grant execute on function public.testagram_require_privileged_session() to authenticated;
