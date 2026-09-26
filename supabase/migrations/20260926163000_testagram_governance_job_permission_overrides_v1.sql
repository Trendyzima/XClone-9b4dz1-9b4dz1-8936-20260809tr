-- Governance assignment overrides let the owner grant/revoke individual job permissions
-- without changing the underlying role. This is the least-privilege layer for appointments.
create table if not exists public.testagram_governance_assignment_permissions (
  assignment_id uuid not null references public.testagram_governance_admin_assignments(id) on delete cascade,
  permission_key text not null references public.testagram_governance_permissions(key) on delete cascade,
  effect text not null check (effect in ('allow','deny')),
  created_at timestamptz not null default now(),
  primary key (assignment_id, permission_key)
);

alter table public.testagram_governance_assignment_permissions enable row level security;
revoke all on public.testagram_governance_assignment_permissions from anon, authenticated;
revoke all on public.testagram_governance_assignment_permissions from public;

create index if not exists idx_testagram_governance_assignment_permissions_assignment
  on public.testagram_governance_assignment_permissions(assignment_id);

create or replace function public.testagram_get_governance()
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'is_owner', public.testagram_is_owner(),
    'is_admin', public.testagram_is_owner() or exists(
      select 1 from public.testagram_governance_admin_assignments a
      where a.user_id=(select auth.uid()) and a.status='active'
    ),
    'role', case when public.testagram_is_owner() then 'owner' else (
      select r.name from public.testagram_governance_admin_assignments a
      join public.testagram_governance_roles r on r.id=a.role_id
      where a.user_id=(select auth.uid()) and a.status='active' limit 1
    ) end,
    'status', case when public.testagram_is_owner() then 'active' else (
      select a.status from public.testagram_governance_admin_assignments a
      where a.user_id=(select auth.uid()) limit 1
    ) end,
    'permissions', case when public.testagram_is_owner() then (
      select coalesce(jsonb_agg(p.key order by p.key),'[]'::jsonb)
      from public.testagram_governance_permissions p
    ) else (
      select coalesce(jsonb_agg(x.permission_key order by x.permission_key),'[]'::jsonb)
      from (
        select rp.permission_key
        from public.testagram_governance_admin_assignments a
        join public.testagram_governance_role_permissions rp on rp.role_id=a.role_id
        where a.user_id=(select auth.uid()) and a.status='active'
        union
        select ap.permission_key
        from public.testagram_governance_admin_assignments a
        join public.testagram_governance_assignment_permissions ap on ap.assignment_id=a.id
        where a.user_id=(select auth.uid()) and a.status='active' and ap.effect='allow'
        except
        select ap.permission_key
        from public.testagram_governance_admin_assignments a
        join public.testagram_governance_assignment_permissions ap on ap.assignment_id=a.id
        where a.user_id=(select auth.uid()) and a.status='active' and ap.effect='deny'
      ) x
    ) end
  );
$$;

create or replace function public.testagram_list_governance_permissions()
returns table(key text, description text)
language sql stable security definer set search_path=''
as $$
  select p.key,p.description
  from public.testagram_governance_permissions p
  where public.testagram_is_owner() or public.testagram_has_permission('governance.roles.manage')
  order by p.key;
$$;

create or replace function public.testagram_appoint_admin_v2(
  p_user_id uuid,
  p_role_name text,
  p_allow_permissions text[] default null,
  p_deny_permissions text[] default null
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_role_id uuid; v_assignment_id uuid; v_key text;
begin
  if not public.testagram_is_owner() then raise exception 'Only the Testagram system owner can appoint administrators'; end if;
  perform public.testagram_require_privileged_session();
  if p_user_id=(select auth.uid()) then raise exception 'The owner account does not need an administrator assignment'; end if;
  select id into v_role_id from public.testagram_governance_roles where name=p_role_name and is_system_role=true;
  if v_role_id is null then raise exception 'Unknown governance role'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'User does not exist'; end if;

  insert into public.testagram_governance_admin_assignments(user_id,role_id,status,appointed_by,revoked_at)
  values(p_user_id,v_role_id,'active',(select auth.uid()),null)
  on conflict(user_id) do update set role_id=excluded.role_id,status='active',appointed_by=excluded.appointed_by,updated_at=now(),revoked_at=null
  returning id into v_assignment_id;

  delete from public.testagram_governance_assignment_permissions where assignment_id=v_assignment_id;
  if p_allow_permissions is not null then
    foreach v_key in array p_allow_permissions loop
      if not exists(select 1 from public.testagram_governance_permissions where key=v_key) then raise exception 'Unknown permission: %',v_key; end if;
      insert into public.testagram_governance_assignment_permissions(assignment_id,permission_key,effect) values(v_assignment_id,v_key,'allow');
    end loop;
  end if;
  if p_deny_permissions is not null then
    foreach v_key in array p_deny_permissions loop
      if not exists(select 1 from public.testagram_governance_permissions where key=v_key) then raise exception 'Unknown permission: %',v_key; end if;
      insert into public.testagram_governance_assignment_permissions(assignment_id,permission_key,effect) values(v_assignment_id,v_key,'deny')
      on conflict (assignment_id,permission_key) do update set effect='deny';
    end loop;
  end if;

  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason,metadata)
  values((select auth.uid()),'admin.appointed',p_user_id,p_role_name,'Owner appointment',
    jsonb_build_object('allow_permissions',coalesce(to_jsonb(p_allow_permissions),'[]'::jsonb),'deny_permissions',coalesce(to_jsonb(p_deny_permissions),'[]'::jsonb)));
  return public.testagram_get_governance_for_user(p_user_id);
end;
$$;

create or replace function public.testagram_bootstrap_owner(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_count integer; v_existing uuid;
begin
  select count(*),min(id) into v_count,v_existing from public.profiles;
  if exists(select 1 from public.testagram_governance_owner where singleton=true) then
    return false;
  end if;
  if v_count <> 1 or v_existing <> p_user_id then
    raise exception 'Owner bootstrap requires exactly one existing profile and an exact user id match';
  end if;
  insert into public.testagram_governance_owner(singleton,user_id) values(true,p_user_id);
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(null,'owner.bootstrapped',p_user_id,'Initial Testagram system owner',jsonb_build_object('method','single-profile bootstrap'));
  return true;
end;
$$;

revoke all on function public.testagram_bootstrap_owner(uuid) from public,anon,authenticated;
revoke all on function public.testagram_list_governance_permissions() from public,anon;
grant execute on function public.testagram_list_governance_permissions() to authenticated;
grant execute on function public.testagram_bootstrap_owner(uuid) to service_role;
grant execute on function public.testagram_appoint_admin_v2(uuid,text,text[],text[]) to authenticated;

do $$
declare v_count integer; v_id uuid;
begin
  select count(*),min(id) into v_count,v_id from public.profiles;
  if v_count=1 and not exists(select 1 from public.testagram_governance_owner where singleton=true) then
    insert into public.testagram_governance_owner(singleton,user_id) values(true,v_id);
    insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
    values(null,'owner.bootstrapped','v_id'::uuid,'Initial Testagram system owner',jsonb_build_object('method','migration-single-profile-bootstrap'));
  end if;
end $$;
