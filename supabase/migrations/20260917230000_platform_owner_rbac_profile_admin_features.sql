-- Testagram platform-owner control plane.
-- Bootstrap owner is the earliest production account identified during the backend audit.
-- The owner UUID is authoritative; email is resolved from auth.users and is not used as a mutable authorization key.

create table if not exists public.platform_control (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.platform_control(singleton, owner_user_id)
values (true, '1ccb7797-d675-4e73-a509-acc1328edbc8')
on conflict (singleton) do nothing;

create or replace function public.is_platform_owner(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_control pc
    where pc.singleton = true
      and pc.owner_user_id = coalesce(p_user_id, auth.uid())
  );
$$;

create table if not exists public.platform_roles (
  key text primary key,
  title text not null,
  description text not null,
  can_appoint boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.platform_roles(key, title, description, can_appoint) values
('platform_admin','Platform Admin','Broad platform administration without ownership transfer or role appointment authority.',false),
('operations_manager','Operations Manager','Operational controls, service health, queues, workflows and internal operations.',false),
('finance_manager','Finance Manager','Financial dashboards, reconciliation, payments, payouts and treasury visibility.',false),
('ads_manager','Ads Manager','Advertising review, campaigns, creatives, spend and ad analytics.',false),
('moderation_manager','Moderation Manager','Reports, moderation, policy enforcement and account safety operations.',false),
('verification_manager','Verification Manager','Verification requests, review and verification operations.',false),
('support_manager','Support Manager','Platform inbox, support workflows and user-service operations.',false),
('analytics_manager','Analytics Manager','Platform, revenue, content and performance analytics.',false)
on conflict (key) do update set title=excluded.title, description=excluded.description, can_appoint=excluded.can_appoint;

create table if not exists public.platform_features (
  key text primary key,
  title text not null,
  description text not null,
  route text,
  created_at timestamptz not null default now()
);

insert into public.platform_features(key,title,description,route) values
('platform.overview','Platform Overview','Global platform administration dashboard.','/admin'),
('platform.roles','Roles & Appointments','Appoint, activate, deactivate and revoke platform roles.','/platform-control'),
('platform.users','User Administration','Platform-wide user administration and account operations.','/admin'),
('platform.moderation','Moderation','Reports, enforcement, fraud and safety workflows.','/admin'),
('platform.verification','Verification','Review and process verification requests.','/admin/verifications'),
('platform.ads','Advertising Administration','Ad review, configuration, campaigns and ad analytics.','/admin/ads-review'),
('platform.finance','Financial Control','Revenue, payouts, treasury and financial operations.','/admin/revenue'),
('platform.analytics','Platform Analytics','Platform-wide performance and revenue analytics.','/revenue-analytics'),
('platform.fraud','Fraud & Risk','Fraud alerts and risk operations.','/fraud-detection'),
('platform.operations','Operations','Operational service controls and internal workflows.','/platform-control'),
('platform.support','Support','Platform inbox and support operations.','/platform-inbox'),
('platform.audit','Audit','Administrative and financial audit visibility.','/regulator'),
('platform.settings','Platform Settings','Platform configuration and governance settings.','/platform-control')
on conflict (key) do update set title=excluded.title, description=excluded.description, route=excluded.route;

create table if not exists public.platform_role_features (
  role_key text not null references public.platform_roles(key) on delete cascade,
  feature_key text not null references public.platform_features(key) on delete cascade,
  primary key(role_key, feature_key)
);

insert into public.platform_role_features(role_key,feature_key)
select 'platform_admin', key from public.platform_features
where key <> 'platform.roles'
on conflict do nothing;

insert into public.platform_role_features(role_key,feature_key) values
('operations_manager','platform.overview'),('operations_manager','platform.operations'),('operations_manager','platform.support'),
('finance_manager','platform.overview'),('finance_manager','platform.finance'),('finance_manager','platform.analytics'),('finance_manager','platform.audit'),
('ads_manager','platform.overview'),('ads_manager','platform.ads'),('ads_manager','platform.analytics'),
('moderation_manager','platform.overview'),('moderation_manager','platform.users'),('moderation_manager','platform.moderation'),('moderation_manager','platform.fraud'),
('verification_manager','platform.overview'),('verification_manager','platform.verification'),
('support_manager','platform.overview'),('support_manager','platform.support'),('support_manager','platform.users'),
('analytics_manager','platform.overview'),('analytics_manager','platform.analytics')
on conflict do nothing;

create table if not exists public.platform_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role_key text not null references public.platform_roles(key),
  active boolean not null default false,
  appointed_by uuid not null,
  appointed_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  unique(user_id, role_key)
);

create table if not exists public.platform_feature_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_key text not null references public.platform_features(key),
  active boolean not null default false,
  appointed_by uuid not null,
  appointed_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  unique(user_id, feature_key)
);

alter table public.platform_control enable row level security;
alter table public.platform_roles enable row level security;
alter table public.platform_features enable row level security;
alter table public.platform_role_features enable row level security;
alter table public.platform_role_assignments enable row level security;
alter table public.platform_feature_assignments enable row level security;

-- The owner can inspect governance state; normal users cannot read the owner record.
drop policy if exists platform_control_owner_read on public.platform_control;
create policy platform_control_owner_read on public.platform_control
for select to authenticated using (public.is_platform_owner());

-- Role/feature catalogs are safe to read only through authenticated sessions.
drop policy if exists platform_roles_authenticated_read on public.platform_roles;
create policy platform_roles_authenticated_read on public.platform_roles
for select to authenticated using (true);
drop policy if exists platform_features_authenticated_read on public.platform_features;
create policy platform_features_authenticated_read on public.platform_features
for select to authenticated using (true);
drop policy if exists platform_role_features_authenticated_read on public.platform_role_features;
create policy platform_role_features_authenticated_read on public.platform_role_features
for select to authenticated using (true);

-- Appointed users may see their own latent assignments; the owner sees all.
drop policy if exists platform_role_assignments_read on public.platform_role_assignments;
create policy platform_role_assignments_read on public.platform_role_assignments
for select to authenticated
using (user_id = auth.uid() or public.is_platform_owner());

drop policy if exists platform_feature_assignments_read on public.platform_feature_assignments;
create policy platform_feature_assignments_read on public.platform_feature_assignments
for select to authenticated
using (user_id = auth.uid() or public.is_platform_owner());

-- Only the platform owner can appoint or mutate platform roles/features.
drop policy if exists platform_role_assignments_owner_write on public.platform_role_assignments;
create policy platform_role_assignments_owner_write on public.platform_role_assignments
for all to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner() and appointed_by = auth.uid());

drop policy if exists platform_feature_assignments_owner_write on public.platform_feature_assignments;
create policy platform_feature_assignments_owner_write on public.platform_feature_assignments
for all to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner() and appointed_by = auth.uid());

create or replace function public.platform_appoint_role(
  p_user_id uuid,
  p_role_key text,
  p_activate boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'platform owner required';
  end if;
  if not exists (select 1 from public.platform_roles where key = p_role_key) then
    raise exception 'unknown platform role';
  end if;

  insert into public.platform_role_assignments(user_id, role_key, active, appointed_by, activated_at)
  values (p_user_id, p_role_key, p_activate, auth.uid(), case when p_activate then now() else null end)
  on conflict (user_id, role_key) do update set
    active = excluded.active,
    appointed_by = auth.uid(),
    revoked_at = null,
    activated_at = case when excluded.active then coalesce(platform_role_assignments.activated_at, now()) else null end
  returning id into v_id;

  insert into public.platform_feature_assignments(user_id, feature_key, active, appointed_by, activated_at)
  select p_user_id, rf.feature_key, p_activate, auth.uid(), case when p_activate then now() else null end
  from public.platform_role_features rf
  where rf.role_key = p_role_key
  on conflict (user_id, feature_key) do update set
    active = case when excluded.active then true else platform_feature_assignments.active end,
    appointed_by = auth.uid(),
    revoked_at = null,
    activated_at = case when excluded.active then coalesce(platform_feature_assignments.activated_at, now()) else platform_feature_assignments.activated_at end;

  return v_id;
end;
$$;

create or replace function public.platform_set_role_active(
  p_assignment_id uuid,
  p_active boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role text;
begin
  if not public.is_platform_owner() then raise exception 'platform owner required'; end if;
  select user_id, role_key into v_user_id, v_role
  from public.platform_role_assignments
  where id = p_assignment_id;
  if v_user_id is null then raise exception 'role assignment not found'; end if;

  update public.platform_role_assignments
  set active = p_active,
      activated_at = case when p_active then coalesce(activated_at, now()) else activated_at end,
      revoked_at = case when p_active then null else revoked_at end
  where id = p_assignment_id;

  update public.platform_feature_assignments pfa
  set active = case when p_active then true else pfa.active end,
      activated_at = case when p_active then coalesce(pfa.activated_at, now()) else pfa.activated_at end
  where pfa.user_id = v_user_id
    and pfa.feature_key in (select feature_key from public.platform_role_features where role_key = v_role);
end;
$$;

create or replace function public.platform_revoke_role(p_assignment_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role text;
begin
  if not public.is_platform_owner() then raise exception 'platform owner required'; end if;
  select user_id, role_key into v_user_id, v_role from public.platform_role_assignments where id = p_assignment_id;
  if v_user_id is null then raise exception 'role assignment not found'; end if;
  update public.platform_role_assignments set active=false, revoked_at=now() where id=p_assignment_id;
  update public.platform_feature_assignments set active=false, revoked_at=now()
  where user_id=v_user_id and feature_key in (select feature_key from public.platform_role_features where role_key=v_role);
end;
$$;

create or replace function public.platform_has_feature(p_feature_key text, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.is_platform_owner(p_user_id)
      or exists (
        select 1 from public.platform_feature_assignments pfa
        where pfa.user_id = coalesce(p_user_id, auth.uid())
          and pfa.feature_key = p_feature_key
          and pfa.active = true
      );
$$;

revoke all on function public.is_platform_owner(uuid) from public;
revoke all on function public.platform_appoint_role(uuid,text,boolean) from public;
revoke all on function public.platform_set_role_active(uuid,boolean) from public;
revoke all on function public.platform_revoke_role(uuid) from public;
revoke all on function public.platform_has_feature(text,uuid) from public;
grant execute on function public.is_platform_owner(uuid) to authenticated;
grant execute on function public.platform_appoint_role(uuid,text,boolean) to authenticated;
grant execute on function public.platform_set_role_active(uuid,boolean) to authenticated;
grant execute on function public.platform_revoke_role(uuid) to authenticated;
grant execute on function public.platform_has_feature(text,uuid) to authenticated;

-- Bootstrap the owner with every feature. These rows are still governed by owner-only writes.
insert into public.platform_feature_assignments(user_id,feature_key,active,appointed_by,activated_at)
select pc.owner_user_id, pf.key, true, pc.owner_user_id, now()
from public.platform_control pc cross join public.platform_features pf
on conflict (user_id,feature_key) do update set active=true, revoked_at=null;

comment on table public.platform_control is 'Canonical Testagram platform ownership control. Owner identity is a user UUID resolved through Supabase Auth.';
comment on table public.platform_role_assignments is 'Server-authoritative appointment state for platform admins/managers.';
comment on table public.platform_feature_assignments is 'Latent profile admin capabilities; inactive assignments remain hidden until activated by the platform owner.';
