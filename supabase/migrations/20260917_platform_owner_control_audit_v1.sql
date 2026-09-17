create or replace function public.platform_audit_role_action(p_action text, p_assignment_id uuid, p_target_user_id uuid, p_role_key text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='public' as $$
begin
  if not public.is_platform_owner() then raise exception 'platform owner required'; end if;
  insert into public.audit_events(user_id,event_type,resource_type,resource_id,metadata)
  values(auth.uid(), p_action, 'platform_role_assignment', p_assignment_id,
    jsonb_build_object('target_user_id',p_target_user_id,'role_key',p_role_key,'details',coalesce(p_details,'{}'::jsonb)));
end; $$;

create or replace function public.platform_appoint_role(p_user_id uuid, p_role_key text, p_activate boolean default false)
returns uuid language plpgsql set search_path='public' as $$
declare v_id uuid;
begin
  if not public.is_platform_owner() then raise exception 'platform owner required'; end if;
  if not exists(select 1 from public.platform_roles where key=p_role_key) then raise exception 'unknown platform role'; end if;
  insert into public.platform_role_assignments(user_id,role_key,active,appointed_by,activated_at)
  values(p_user_id,p_role_key,p_activate,auth.uid(),case when p_activate then now() else null end)
  on conflict(user_id,role_key) do update set active=excluded.active,appointed_by=auth.uid(),revoked_at=null,activated_at=case when excluded.active then coalesce(platform_role_assignments.activated_at,now()) else null end
  returning id into v_id;
  insert into public.platform_feature_assignments(user_id,feature_key,active,appointed_by,activated_at)
  select p_user_id,rf.feature_key,p_activate,auth.uid(),case when p_activate then now() else null end
  from public.platform_role_features rf where rf.role_key=p_role_key
  on conflict(user_id,feature_key) do update set active=case when excluded.active then true else platform_feature_assignments.active end,appointed_by=auth.uid(),revoked_at=null,activated_at=case when excluded.active then coalesce(platform_feature_assignments.activated_at,now()) else platform_feature_assignments.activated_at end;
  perform public.platform_audit_role_action(case when p_activate then 'platform.role.appointed_and_activated' else 'platform.role.appointed' end,v_id,p_user_id,p_role_key,jsonb_build_object('activate',p_activate));
  return v_id;
end; $$;

create or replace function public.platform_revoke_role(p_assignment_id uuid)
returns void language plpgsql set search_path='public' as $$
declare v_user_id uuid; v_role text;
begin
  if not public.is_platform_owner() then raise exception 'platform owner required'; end if;
  select user_id, role_key into v_user_id, v_role from public.platform_role_assignments where id=p_assignment_id;
  if v_user_id is null then raise exception 'role assignment not found'; end if;
  update public.platform_role_assignments set active=false, revoked_at=now() where id=p_assignment_id;
  update public.platform_feature_assignments pfa set active=exists(select 1 from public.platform_role_assignments pra join public.platform_role_features prf on prf.role_key=pra.role_key where pra.user_id=v_user_id and pra.active=true and pra.revoked_at is null and prf.feature_key=pfa.feature_key), revoked_at=case when exists(select 1 from public.platform_role_assignments pra join public.platform_role_features prf on prf.role_key=pra.role_key where pra.user_id=v_user_id and pra.active=true and pra.revoked_at is null and prf.feature_key=pfa.feature_key) then null else now() end where pfa.user_id=v_user_id and pfa.feature_key in(select feature_key from public.platform_role_features where role_key=v_role);
  perform public.platform_audit_role_action('platform.role.revoked',p_assignment_id,v_user_id,v_role);
end; $$;

create or replace function public.platform_set_role_active(p_assignment_id uuid, p_active boolean)
returns void language plpgsql set search_path='public' as $$
declare v_user_id uuid; v_role text;
begin
  if not public.is_platform_owner() then raise exception 'platform owner required'; end if;
  select user_id, role_key into v_user_id, v_role from public.platform_role_assignments where id=p_assignment_id;
  if v_user_id is null then raise exception 'role assignment not found'; end if;
  update public.platform_role_assignments set active=p_active, activated_at=case when p_active then coalesce(activated_at,now()) else activated_at end, revoked_at=case when p_active then null else revoked_at end where id=p_assignment_id;
  update public.platform_feature_assignments pfa set active=exists(select 1 from public.platform_role_assignments pra join public.platform_role_features prf on prf.role_key=pra.role_key where pra.user_id=v_user_id and pra.active=true and pra.revoked_at is null and prf.feature_key=pfa.feature_key), revoked_at=case when exists(select 1 from public.platform_role_assignments pra join public.platform_role_features prf on prf.role_key=pra.role_key where pra.user_id=v_user_id and pra.active=true and pra.revoked_at is null and prf.feature_key=pfa.feature_key) then null else pfa.revoked_at end where pfa.user_id=v_user_id and pfa.feature_key in(select feature_key from public.platform_role_features where role_key=v_role);
  perform public.platform_audit_role_action(case when p_active then 'platform.role.activated' else 'platform.role.deactivated' end,p_assignment_id,v_user_id,v_role,jsonb_build_object('active',p_active));
end; $$;

create or replace function public.platform_control_audit(limit_count integer default 100)
returns table(id uuid,user_id uuid,event_type text,resource_type text,resource_id uuid,metadata jsonb,created_at timestamptz)
language sql security definer set search_path='public' as $$
  select a.id,a.user_id,a.event_type,a.resource_type,a.resource_id,a.metadata,a.created_at
  from public.audit_events a
  where public.is_platform_owner()
  order by a.created_at desc
  limit greatest(1,least(limit_count,500));
$$;

grant execute on function public.platform_control_audit(integer) to authenticated;
grant execute on function public.platform_audit_role_action(text,uuid,uuid,text,jsonb) to authenticated;
