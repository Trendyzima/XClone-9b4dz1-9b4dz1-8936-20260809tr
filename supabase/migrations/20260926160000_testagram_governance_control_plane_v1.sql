-- Testagram governance control plane: owner -> roles -> permissions -> audit.
create table if not exists public.testagram_governance_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testagram_governance_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  is_system_role boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.testagram_governance_permissions (
  key text primary key,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.testagram_governance_role_permissions (
  role_id uuid not null references public.testagram_governance_roles(id) on delete cascade,
  permission_key text not null references public.testagram_governance_permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table if not exists public.testagram_governance_admin_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role_id uuid not null references public.testagram_governance_roles(id) on delete restrict,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  appointed_by uuid not null references auth.users(id) on delete restrict,
  appointed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.testagram_governance_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  role_name text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_testagram_governance_assignments_status
  on public.testagram_governance_admin_assignments(status);
create index if not exists idx_testagram_governance_audit_actor_created
  on public.testagram_governance_audit_log(actor_user_id, created_at desc);
create index if not exists idx_testagram_governance_audit_target_created
  on public.testagram_governance_audit_log(target_user_id, created_at desc);

insert into public.testagram_governance_permissions(key, description) values
('governance.read','View governance status and administration surfaces'),
('governance.admins.read','View administrator assignments'),
('governance.admins.manage','Appoint, change, suspend, and revoke administrators'),
('governance.roles.manage','Manage governance roles and permission mappings'),
('governance.audit.read','View governance audit history'),
('users.read','View platform user records in administrative surfaces'),
('users.restrict','Restrict or restore user accounts'),
('content.moderate','Review and enforce content policy'),
('reports.manage','Review and resolve platform reports'),
('support.manage','Manage platform support workflows'),
('publishers.manage','Manage publisher/RSS sources'),
('fediverse.manage','Manage platform federation controls'),
('live.manage','Manage platform live/media operations'),
('finance.read','View platform financial administration data'),
('finance.manage','Perform authorized financial administration'),
('system.read','View platform operational state'),
('system.manage','Manage platform-wide configuration'),
('security.manage','Manage privileged security controls')
on conflict (key) do update set description = excluded.description;

insert into public.testagram_governance_roles(name, description) values
('moderator','Content moderation, reports, and user restrictions'),
('support_admin','Support operations and account assistance'),
('finance_admin','Financial administration and reconciliation'),
('content_admin','Publisher, editorial, and content operations'),
('trust_safety','Trust, safety, reports, and enforcement'),
('operations_admin','Platform operations, live/media, and system health'),
('super_admin','Broad operational administration without ownership transfer')
on conflict (name) do update set description = excluded.description;

insert into public.testagram_governance_role_permissions(role_id, permission_key)
select r.id, p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='moderator' and p.key in ('governance.read','users.read','users.restrict','content.moderate','reports.manage')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id, permission_key)
select r.id, p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='support_admin' and p.key in ('governance.read','users.read','support.manage')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id, permission_key)
select r.id, p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='finance_admin' and p.key in ('governance.read','finance.read','finance.manage','governance.audit.read')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id, permission_key)
select r.id, p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='content_admin' and p.key in ('governance.read','content.moderate','publishers.manage')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id, permission_key)
select r.id, p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='trust_safety' and p.key in ('governance.read','users.read','users.restrict','content.moderate','reports.manage','security.manage','governance.audit.read')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id, permission_key)
select r.id, p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='operations_admin' and p.key in ('governance.read','users.read','live.manage','fediverse.manage','system.read','system.manage')
on conflict do nothing;

insert into public.testagram_governance_role_permissions(role_id, permission_key)
select r.id, p.key from public.testagram_governance_roles r
cross join public.testagram_governance_permissions p
where r.name='super_admin' and p.key in (
  'governance.read','governance.admins.read','users.read','users.restrict','content.moderate',
  'reports.manage','support.manage','publishers.manage','fediverse.manage','live.manage',
  'finance.read','system.read','security.manage','governance.audit.read'
)
on conflict do nothing;

-- The current sole Testagram account is the initial system owner.
insert into public.testagram_governance_owner(singleton, user_id)
select true, u.id from auth.users u
where u.id='aba391ed-7f8f-41b7-8be5-e7d9c20c4517'
on conflict (singleton) do nothing;

create or replace function public.testagram_is_owner()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1 from public.testagram_governance_owner o
    where o.singleton = true and o.user_id = (select auth.uid())
  );
$$;

create or replace function public.testagram_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.testagram_is_owner()
  or exists (
    select 1
    from public.testagram_governance_admin_assignments a
    join public.testagram_governance_role_permissions rp on rp.role_id = a.role_id
    where a.user_id = (select auth.uid())
      and a.status = 'active'
      and rp.permission_key = p_permission
  );
$$;

create or replace function public.testagram_get_governance()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'is_owner', public.testagram_is_owner(),
    'is_admin', public.testagram_is_owner() or exists (
      select 1 from public.testagram_governance_admin_assignments a
      where a.user_id=(select auth.uid()) and a.status='active'
    ),
    'role', case when public.testagram_is_owner() then 'owner' else (
      select r.name from public.testagram_governance_admin_assignments a
      join public.testagram_governance_roles r on r.id=a.role_id
      where a.user_id=(select auth.uid()) and a.status='active'
      limit 1
    ) end,
    'status', case when public.testagram_is_owner() then 'active' else (
      select a.status from public.testagram_governance_admin_assignments a
      where a.user_id=(select auth.uid())
      limit 1
    ) end,
    'permissions', coalesce((
      select jsonb_agg(rp.permission_key order by rp.permission_key)
      from public.testagram_governance_admin_assignments a
      join public.testagram_governance_role_permissions rp on rp.role_id=a.role_id
      where a.user_id=(select auth.uid()) and a.status='active'
    ), '[]'::jsonb)
  );
$$;

create or replace function public.testagram_appoint_admin(p_user_id uuid, p_role_name text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role_id uuid;
begin
  if not public.testagram_is_owner() then raise exception 'Only the Testagram system owner can appoint administrators'; end if;
  if p_user_id = (select auth.uid()) then raise exception 'The owner account does not need an administrator assignment'; end if;
  select id into v_role_id from public.testagram_governance_roles where name=p_role_name and is_system_role=true;
  if v_role_id is null then raise exception 'Unknown governance role'; end if;
  if not exists (select 1 from auth.users where id=p_user_id) then raise exception 'User does not exist'; end if;
  insert into public.testagram_governance_admin_assignments(user_id,role_id,status,appointed_by,revoked_at)
  values(p_user_id,v_role_id,'active',(select auth.uid()),null)
  on conflict(user_id) do update set role_id=excluded.role_id,status='active',appointed_by=excluded.appointed_by,updated_at=now(),revoked_at=null;
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason)
  values((select auth.uid()),'admin.appointed',p_user_id,p_role_name,'Owner appointment');
  return public.testagram_get_governance_for_user(p_user_id);
end;
$$;

create or replace function public.testagram_get_governance_for_user(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'is_owner', exists(select 1 from public.testagram_governance_owner o where o.singleton=true and o.user_id=p_user_id),
    'is_admin', exists(select 1 from public.testagram_governance_owner o where o.singleton=true and o.user_id=p_user_id)
      or exists(select 1 from public.testagram_governance_admin_assignments a where a.user_id=p_user_id and a.status='active'),
    'role', case when exists(select 1 from public.testagram_governance_owner o where o.singleton=true and o.user_id=p_user_id) then 'owner'
      else (select r.name from public.testagram_governance_admin_assignments a join public.testagram_governance_roles r on r.id=a.role_id where a.user_id=p_user_id and a.status='active' limit 1) end
  );
$$;

create or replace function public.testagram_update_admin(p_user_id uuid, p_role_name text, p_status text default 'active', p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_role_id uuid;
begin
  if not public.testagram_is_owner() then raise exception 'Only the Testagram system owner can manage administrators'; end if;
  if p_user_id = (select auth.uid()) then raise exception 'The owner cannot be changed through administrator assignment'; end if;
  if p_status not in ('active','suspended','revoked') then raise exception 'Invalid administrator status'; end if;
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

create or replace function public.testagram_list_admins()
returns table(
  user_id uuid, username text, display_name text, avatar_url text,
  role_name text, status text, appointed_at timestamptz, appointed_by uuid
)
language sql
stable
security definer
set search_path=''
as $$
  select a.user_id,p.username,p.display_name,p.avatar_url,r.name,a.status,a.appointed_at,a.appointed_by
  from public.testagram_governance_admin_assignments a
  join public.profiles p on p.id=a.user_id
  join public.testagram_governance_roles r on r.id=a.role_id
  where public.testagram_is_owner() or public.testagram_has_permission('governance.admins.read')
  order by a.status='active' desc,a.appointed_at desc;
$$;

create or replace function public.testagram_search_governance_users(p_query text, p_limit integer default 20)
returns table(user_id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path=''
as $$
  select p.id,p.username,p.display_name,p.avatar_url
  from public.profiles p
  where public.testagram_is_owner()
    and p.account_status='active'
    and (
      p.username ilike '%' || trim(p_query) || '%'
      or coalesce(p.display_name,'') ilike '%' || trim(p_query) || '%'
    )
  order by p.username
  limit least(greatest(coalesce(p_limit,20),1),50);
$$;

create or replace function public.testagram_governance_audit(p_limit integer default 100)
returns table(id uuid, actor_user_id uuid, actor_username text, action text, target_user_id uuid, target_username text, role_name text, reason text, metadata jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path=''
as $$
  select l.id,l.actor_user_id,ap.username,l.action,l.target_user_id,tp.username,l.role_name,l.reason,l.metadata,l.created_at
  from public.testagram_governance_audit_log l
  left join public.profiles ap on ap.id=l.actor_user_id
  left join public.profiles tp on tp.id=l.target_user_id
  where public.testagram_is_owner() or public.testagram_has_permission('governance.audit.read')
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit,100),1),200);
$$;

revoke all on public.testagram_governance_owner from anon, authenticated;
revoke all on public.testagram_governance_roles from anon, authenticated;
revoke all on public.testagram_governance_permissions from anon, authenticated;
revoke all on public.testagram_governance_role_permissions from anon, authenticated;
revoke all on public.testagram_governance_admin_assignments from anon, authenticated;
revoke all on public.testagram_governance_audit_log from anon, authenticated;

alter table public.testagram_governance_owner enable row level security;
alter table public.testagram_governance_roles enable row level security;
alter table public.testagram_governance_permissions enable row level security;
alter table public.testagram_governance_role_permissions enable row level security;
alter table public.testagram_governance_admin_assignments enable row level security;
alter table public.testagram_governance_audit_log enable row level security;

revoke all on function public.testagram_is_owner() from public, anon;
revoke all on function public.testagram_has_permission(text) from public, anon;
revoke all on function public.testagram_get_governance() from public, anon;
revoke all on function public.testagram_get_governance_for_user(uuid) from public, anon;
revoke all on function public.testagram_appoint_admin(uuid,text) from public, anon;
revoke all on function public.testagram_update_admin(uuid,text,text,text) from public, anon;
revoke all on function public.testagram_list_admins() from public, anon;
revoke all on function public.testagram_search_governance_users(text,integer) from public, anon;
revoke all on function public.testagram_governance_audit(integer) from public, anon;
grant execute on function public.testagram_is_owner() to authenticated;
grant execute on function public.testagram_has_permission(text) to authenticated;
grant execute on function public.testagram_get_governance() to authenticated;
grant execute on function public.testagram_get_governance_for_user(uuid) to authenticated;
grant execute on function public.testagram_appoint_admin(uuid,text) to authenticated;
grant execute on function public.testagram_update_admin(uuid,text,text,text) to authenticated;
grant execute on function public.testagram_list_admins() to authenticated;
grant execute on function public.testagram_search_governance_users(text,integer) to authenticated;
grant execute on function public.testagram_governance_audit(integer) to authenticated;

insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
select null,'owner.bootstrap',o.user_id,'Initial Testagram system owner bootstrap',jsonb_build_object('source','governance_migration')
from public.testagram_governance_owner o
where o.user_id='aba391ed-7f8f-41b7-8be5-e7d9c20c4517'
  and not exists (select 1 from public.testagram_governance_audit_log where action='owner.bootstrap');

-- No direct table writes are granted to client roles; all mutations flow through owner-gated functions.
