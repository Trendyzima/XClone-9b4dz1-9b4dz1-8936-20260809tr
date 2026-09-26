-- Testagram staff employment, invitations, recruitment and role workspaces.
create table if not exists public.testagram_job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_name text not null references public.testagram_governance_roles(name) on delete restrict,
  statement text not null default '',
  status text not null default 'submitted' check (status in ('submitted','reviewing','shortlisted','accepted','rejected','withdrawn')),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_testagram_job_applications_status_created on public.testagram_job_applications(status, created_at desc);
create index if not exists idx_testagram_job_applications_user_created on public.testagram_job_applications(user_id, created_at desc);

create table if not exists public.testagram_governance_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.testagram_governance_admin_assignments(id) on delete set null,
  role_name text not null references public.testagram_governance_roles(name) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz,
  note text
);
create index if not exists idx_testagram_governance_invitations_user_status on public.testagram_governance_invitations(user_id, status, invited_at desc);
create index if not exists idx_testagram_governance_invitations_status on public.testagram_governance_invitations(status, invited_at desc);

alter table public.testagram_governance_admin_assignments
  add column if not exists employment_status text not null default 'active' check (employment_status in ('active','suspended','terminated')),
  add column if not exists employment_started_at timestamptz,
  add column if not exists employment_ended_at timestamptz,
  add column if not exists invitation_id uuid references public.testagram_governance_invitations(id) on delete set null;

alter table public.testagram_job_applications enable row level security;
alter table public.testagram_governance_invitations enable row level security;
revoke all on public.testagram_job_applications from anon, authenticated, public;
revoke all on public.testagram_governance_invitations from anon, authenticated, public;

create or replace function public.testagram_list_open_jobs()
returns table(role_name text, title text, description text, permissions text[])
language sql stable security definer set search_path=''
as $$
 select r.name, initcap(replace(r.name,'_',' ')), r.description,
   coalesce(array_agg(rp.permission_key order by rp.permission_key) filter (where rp.permission_key is not null),'{}'::text[])
 from public.testagram_governance_roles r
 left join public.testagram_governance_role_permissions rp on rp.role_id=r.id
 where r.is_system_role=true group by r.name,r.description order by r.name;
$$;

create or replace function public.testagram_apply_for_job(p_role_name text,p_statement text default '')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.testagram_governance_roles where name=p_role_name and is_system_role=true) then raise exception 'Unknown Testagram job'; end if;
 if exists(select 1 from public.testagram_job_applications where user_id=(select auth.uid()) and role_name=p_role_name and status in ('submitted','reviewing','shortlisted')) then raise exception 'You already have an active application for this role'; end if;
 insert into public.testagram_job_applications(user_id,role_name,statement) values((select auth.uid()),p_role_name,left(coalesce(p_statement,''),4000)) returning id into v_id;
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason,metadata)
 values((select auth.uid()),'job.application.submitted',(select auth.uid()),p_role_name,'User applied for Testagram role',jsonb_build_object('application_id',v_id));
 return jsonb_build_object('id',v_id,'status','submitted');
end;
$$;

create or replace function public.testagram_my_job_applications()
returns table(id uuid,role_name text,role_title text,statement text,status text,review_note text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=''
as $$
 select a.id,a.role_name,initcap(replace(a.role_name,'_',' ')),a.statement,a.status,a.review_note,a.created_at,a.updated_at
 from public.testagram_job_applications a where a.user_id=(select auth.uid()) order by a.created_at desc;
$$;

create or replace function public.testagram_list_job_applications(p_status text default null)
returns table(id uuid,user_id uuid,username text,display_name text,role_name text,statement text,status text,review_note text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=''
as $$
 select a.id,a.user_id,p.username,p.display_name,a.role_name,a.statement,a.status,a.review_note,a.created_at,a.updated_at
 from public.testagram_job_applications a join public.profiles p on p.id=a.user_id
 where public.testagram_is_owner() and (p_status is null or a.status=p_status) order by a.created_at desc;
$$;

create or replace function public.testagram_review_job_application(p_application_id uuid,p_status text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid; v_role text;
begin
 if not public.testagram_is_owner() then raise exception 'Only the system owner can review job applications'; end if;
 if p_status not in ('reviewing','shortlisted','accepted','rejected','withdrawn') then raise exception 'Invalid application status'; end if;
 select user_id,role_name into v_user,v_role from public.testagram_job_applications where id=p_application_id for update;
 if v_user is null then raise exception 'Application not found'; end if;
 update public.testagram_job_applications set status=p_status,reviewed_by=(select auth.uid()),review_note=left(p_note,4000),updated_at=now() where id=p_application_id;
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason,metadata)
 values((select auth.uid()),'job.application.reviewed',v_user,v_role,coalesce(p_note,'Owner reviewed application'),jsonb_build_object('application_id',p_application_id,'status',p_status));
 return jsonb_build_object('id',p_application_id,'status',p_status);
end;
$$;

create or replace function public.testagram_invite_admin(p_user_id uuid,p_role_name text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_role_id uuid; v_assignment uuid; v_invite uuid;
begin
 if not public.testagram_is_owner() then raise exception 'Only the system owner can invite staff'; end if;
 perform public.testagram_require_privileged_session();
 if p_user_id=(select auth.uid()) then raise exception 'Owner does not need a staff invitation'; end if;
 select id into v_role_id from public.testagram_governance_roles where name=p_role_name and is_system_role=true;
 if v_role_id is null then raise exception 'Unknown Testagram role'; end if;
 insert into public.testagram_governance_admin_assignments(user_id,role_id,status,appointed_by,employment_status,employment_started_at,employment_ended_at,revoked_at)
 values(p_user_id,v_role_id,'active',(select auth.uid()),'active',now(),null,null)
 on conflict(user_id) do update set role_id=excluded.role_id,status='active',appointed_by=excluded.appointed_by,employment_status='active',employment_started_at=coalesce(public.testagram_governance_admin_assignments.employment_started_at,now()),employment_ended_at=null,revoked_at=null,updated_at=now()
 returning id into v_assignment;
 insert into public.testagram_governance_invitations(user_id,assignment_id,role_name,invited_by,note)
 values(p_user_id,v_assignment,p_role_name,(select auth.uid()),left(p_note,2000)) returning id into v_invite;
 update public.testagram_governance_admin_assignments set invitation_id=v_invite where id=v_assignment;
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason,metadata)
 values((select auth.uid()),'staff.invited',p_user_id,p_role_name,'Owner invited staff member; role activated on profile',jsonb_build_object('invitation_id',v_invite,'assignment_id',v_assignment));
 return jsonb_build_object('invitation_id',v_invite,'assignment_id',v_assignment,'role_name',p_role_name,'status','pending','features_active',true);
end;
$$;

create or replace function public.testagram_my_staff_invitations()
returns table(id uuid,role_name text,role_title text,status text,note text,invited_at timestamptz,responded_at timestamptz)
language sql stable security definer set search_path=''
as $$
 select i.id,i.role_name,initcap(replace(i.role_name,'_',' ')),i.status,i.note,i.invited_at,i.responded_at
 from public.testagram_governance_invitations i where i.user_id=(select auth.uid()) and i.status='pending' order by i.invited_at desc;
$$;

create or replace function public.testagram_respond_staff_invitation(p_invitation_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_role text; v_assignment uuid;
begin
 select role_name,assignment_id into v_role,v_assignment from public.testagram_governance_invitations where id=p_invitation_id and user_id=(select auth.uid()) and status='pending' for update;
 if v_role is null then raise exception 'Invitation not found or already resolved'; end if;
 update public.testagram_governance_invitations set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=p_invitation_id;
 if not p_accept then update public.testagram_governance_admin_assignments set status='revoked',employment_status='terminated',employment_ended_at=now(),revoked_at=now(),updated_at=now() where id=v_assignment; end if;
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason,metadata)
 values((select auth.uid()),case when p_accept then 'staff.invitation.accepted' else 'staff.invitation.declined' end,(select auth.uid()),v_role,'Staff invitation response',jsonb_build_object('invitation_id',p_invitation_id));
 return jsonb_build_object('status',case when p_accept then 'accepted' else 'declined' end,'features_active',p_accept);
end;
$$;

create or replace function public.testagram_terminate_staff(p_user_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_role text;
begin
 if not public.testagram_is_owner() then raise exception 'Only the system owner can terminate staff'; end if;
 perform public.testagram_require_privileged_session();
 if p_user_id=(select auth.uid()) then raise exception 'Owner cannot terminate the owner account'; end if;
 select r.name into v_role from public.testagram_governance_admin_assignments a join public.testagram_governance_roles r on r.id=a.role_id where a.user_id=p_user_id;
 if v_role is null then raise exception 'Staff assignment not found'; end if;
 update public.testagram_governance_admin_assignments set status='revoked',employment_status='terminated',employment_ended_at=now(),revoked_at=now(),updated_at=now() where user_id=p_user_id;
 update public.testagram_governance_invitations set status='revoked' where user_id=p_user_id and status='pending';
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason,metadata)
 values((select auth.uid()),'staff.terminated',p_user_id,v_role,coalesce(p_reason,'Owner terminated staff member'),jsonb_build_object('terminated_at',now()));
 return jsonb_build_object('user_id',p_user_id,'status','terminated','features_active',false);
end;
$$;

create or replace function public.testagram_update_admin(p_user_id uuid,p_role_name text,p_status text default 'active',p_reason text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_role_id uuid;
begin
 if not public.testagram_is_owner() then raise exception 'Only the Testagram system owner can manage administrators'; end if;
 if p_user_id=(select auth.uid()) then raise exception 'The owner cannot be changed through administrator assignment'; end if;
 if p_status not in ('active','suspended','revoked') then raise exception 'Invalid administrator status'; end if;
 select id into v_role_id from public.testagram_governance_roles where name=p_role_name;
 if v_role_id is null then raise exception 'Unknown governance role'; end if;
 update public.testagram_governance_admin_assignments set role_id=v_role_id,status=p_status,employment_status=case when p_status='revoked' then 'terminated' when p_status='suspended' then 'suspended' else 'active' end,employment_ended_at=case when p_status='revoked' then now() else null end,updated_at=now(),revoked_at=case when p_status='revoked' then now() else null end where user_id=p_user_id;
 if not found then raise exception 'Administrator assignment not found'; end if;
 insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,role_name,reason)
 values((select auth.uid()),case when p_status='revoked' then 'staff.terminated' when p_status='suspended' then 'staff.suspended' else 'staff.activated' end,p_user_id,p_role_name,coalesce(p_reason,'Owner governance change'));
 return public.testagram_get_governance_for_user(p_user_id);
end;
$$;

revoke all on function public.testagram_list_open_jobs() from public,anon;
revoke all on function public.testagram_apply_for_job(text,text) from public,anon;
revoke all on function public.testagram_my_job_applications() from public,anon;
revoke all on function public.testagram_list_job_applications(text) from public,anon;
revoke all on function public.testagram_review_job_application(uuid,text,text) from public,anon;
revoke all on function public.testagram_invite_admin(uuid,text,text) from public,anon;
revoke all on function public.testagram_my_staff_invitations() from public,anon;
revoke all on function public.testagram_respond_staff_invitation(uuid,boolean) from public,anon;
revoke all on function public.testagram_terminate_staff(uuid,text) from public,anon;
revoke all on function public.testagram_update_admin(uuid,text,text,text) from public,anon;
grant execute on function public.testagram_list_open_jobs() to authenticated;
grant execute on function public.testagram_apply_for_job(text,text) to authenticated;
grant execute on function public.testagram_my_job_applications() to authenticated;
grant execute on function public.testagram_list_job_applications(text) to authenticated;
grant execute on function public.testagram_review_job_application(uuid,text,text) to authenticated;
grant execute on function public.testagram_invite_admin(uuid,text,text) to authenticated;
grant execute on function public.testagram_my_staff_invitations() to authenticated;
grant execute on function public.testagram_respond_staff_invitation(uuid,boolean) to authenticated;
grant execute on function public.testagram_terminate_staff(uuid,text) to authenticated;
grant execute on function public.testagram_update_admin(uuid,text,text,text) to authenticated;
