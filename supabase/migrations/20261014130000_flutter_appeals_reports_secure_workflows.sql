-- Native Flutter appeal and regulator-report workflows.
-- All privileged decisions happen in SECURITY DEFINER RPCs with explicit actor checks.

create table if not exists public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ban_id uuid,
  reason text not null check (char_length(btrim(reason)) between 20 and 800),
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  regulator_note text,
  created_at timestamptz not null default now()
);
-- Existing deployments may have created this table outside the checked-in baseline;
-- reconcile the exact columns needed by the RPC contract without rewriting case history.
alter table public.moderation_appeals add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.moderation_appeals add column if not exists ban_id uuid;
alter table public.moderation_appeals add column if not exists reason text;
alter table public.moderation_appeals add column if not exists status text not null default 'pending';
alter table public.moderation_appeals add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.moderation_appeals add column if not exists reviewed_at timestamptz;
alter table public.moderation_appeals add column if not exists regulator_note text;
alter table public.moderation_appeals add column if not exists created_at timestamptz not null default now();
create index if not exists moderation_appeals_user_created_idx on public.moderation_appeals(user_id, created_at desc);
create index if not exists moderation_appeals_pending_created_idx on public.moderation_appeals(created_at desc) where status='pending';
alter table public.moderation_appeals enable row level security;
revoke all on public.moderation_appeals from anon;
revoke insert, update, delete on public.moderation_appeals from authenticated;
grant select on public.moderation_appeals to authenticated;
drop policy if exists moderation_appeals_self_read on public.moderation_appeals;
create policy moderation_appeals_self_read on public.moderation_appeals for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists moderation_appeals_owner_read on public.moderation_appeals;
create policy moderation_appeals_owner_read on public.moderation_appeals for select to authenticated using (public.testagram_is_owner());

create or replace function public.testagram_submit_moderation_appeal(p_reason text)
returns public.moderation_appeals
language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_ban uuid; v_result public.moderation_appeals;
begin
  if v_user is null then raise exception using errcode='42501', message='Authentication required'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 or char_length(btrim(p_reason)) > 800 then
    raise exception using errcode='22023', message='Appeal reason must contain 20 to 800 characters';
  end if;
  if exists(select 1 from public.moderation_appeals a where a.user_id=v_user and a.status='pending') then
    raise exception using errcode='23505', message='A pending appeal already exists';
  end if;
  select b.id into v_ban from public.user_bans b where b.user_id=v_user and b.is_active=true order by b.banned_at desc limit 1;
  insert into public.moderation_appeals(user_id,ban_id,reason,status)
  values(v_user,v_ban,btrim(p_reason),'pending') returning * into v_result;
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(v_user,'appeal.submit',v_user,'User submitted an account appeal',jsonb_build_object('appeal_id',v_result.id));
  return v_result;
end;
$$;

create or replace function public.testagram_list_my_moderation_appeals()
returns setof public.moderation_appeals
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Authentication required'; end if;
  return query select a.* from public.moderation_appeals a where a.user_id=auth.uid() order by a.created_at desc limit 10;
end;
$$;

create or replace function public.testagram_list_pending_moderation_appeals(p_limit integer default 50)
returns table(id uuid,user_id uuid,ban_id uuid,reason text,status text,reviewed_by uuid,reviewed_at timestamptz,regulator_note text,created_at timestamptz,username text,avatar_url text)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.testagram_is_owner() then raise exception using errcode='42501', message='Owner authorization required'; end if;
  return query select a.id,a.user_id,a.ban_id,a.reason,a.status,a.reviewed_by,a.reviewed_at,a.regulator_note,a.created_at,p.username,p.avatar_url
    from public.moderation_appeals a left join public.profiles p on p.id=a.user_id
    where a.status='pending' order by a.created_at asc limit greatest(1,least(coalesce(p_limit,50),100));
end;
$$;

create or replace function public.testagram_review_moderation_appeal(p_appeal_id uuid,p_decision text,p_note text default null)
returns public.moderation_appeals
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_appeal public.moderation_appeals; v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if v_actor is null or not public.testagram_is_owner() then raise exception using errcode='42501', message='Owner authorization required'; end if;
  if p_decision not in ('approved','denied') then raise exception using errcode='22023', message='Decision must be approved or denied'; end if;
  if v_note is not null and char_length(v_note)>1000 then raise exception using errcode='22023', message='Review note must be 1000 characters or fewer'; end if;
  select * into v_appeal from public.moderation_appeals where id=p_appeal_id for update;
  if not found then raise exception using errcode='P0002', message='Appeal not found'; end if;
  if v_appeal.status <> 'pending' then raise exception using errcode='23514', message='Appeal has already been reviewed'; end if;
  update public.moderation_appeals set status=p_decision,reviewed_by=v_actor,reviewed_at=now(),regulator_note=v_note where id=p_appeal_id returning * into v_appeal;
  if p_decision='approved' and v_appeal.ban_id is not null then
    update public.user_bans set is_active=false,lifted_at=now(),lifted_by=v_actor where id=v_appeal.ban_id and user_id=v_appeal.user_id and is_active=true;
    if not found then raise exception using errcode='23514', message='Linked active restriction was not found; appeal decision rolled back'; end if;
    update public.profiles set is_blocked=false where id=v_appeal.user_id;
  end if;
  insert into public.platform_inbox(user_id,type,subject,body,icon_emoji,read,sent_at,dedupe_key,metadata)
  values(v_appeal.user_id,'update',case when p_decision='approved' then 'Appeal approved' else 'Appeal reviewed' end,
    case when p_decision='approved' then 'Your appeal has been approved.' else 'Your appeal has been reviewed and could not be approved at this time.' end || case when v_note is null then '' else E'\n\nRegulator note: '||v_note end,
    case when p_decision='approved' then '✅' else '📋' end,false,now(),'appeal-review-'||v_appeal.id::text,jsonb_build_object('appeal_id',v_appeal.id,'decision',p_decision));
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(v_actor,'appeal.review',v_appeal.user_id,coalesce(v_note,'Appeal '||p_decision),jsonb_build_object('appeal_id',v_appeal.id,'decision',p_decision));
  return v_appeal;
end;
$$;

create or replace function public.testagram_list_platform_reports(p_status text default 'open',p_limit integer default 100)
returns table(id uuid,post_id uuid,reporter_id uuid,reason text,details text,status text,created_at timestamptz,post_content text,post_author_id uuid,post_author_username text,reporter_username text)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.testagram_is_owner() then raise exception using errcode='42501', message='Owner authorization required'; end if;
  if p_status not in ('open','resolved','dismissed','all') then raise exception using errcode='22023', message='Unsupported report status'; end if;
  return query select r.id,r.post_id,r.reporter_id,r.reason,r.details,r.status,r.created_at,coalesce(p.content,''),p.user_id,author.username,reporter.username
    from public.post_reports r left join public.posts p on p.id=r.post_id
    left join public.profiles author on author.id=coalesce(p.author_id,p.user_id)
    left join public.profiles reporter on reporter.id=r.reporter_id
    where p_status='all' or r.status=p_status
    order by r.created_at desc limit greatest(1,least(coalesce(p_limit,100),200));
end;
$$;

create or replace function public.testagram_resolve_platform_report(p_report_id uuid,p_decision text,p_note text default null)
returns public.post_reports
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_report public.post_reports;
begin
  if v_actor is null or not public.testagram_is_owner() then raise exception using errcode='42501', message='Owner authorization required'; end if;
  if p_decision not in ('resolved','dismissed') then raise exception using errcode='22023', message='Decision must be resolved or dismissed'; end if;
  if p_note is not null and char_length(p_note)>1000 then raise exception using errcode='22023', message='Note must be 1000 characters or fewer'; end if;
  update public.post_reports set status=p_decision where id=p_report_id and status='open' returning * into v_report;
  if not found then raise exception using errcode='P0002', message='Open report not found or already resolved'; end if;
  insert into public.testagram_governance_audit_log(actor_user_id,action,target_user_id,reason,metadata)
  values(v_actor,'report.'||p_decision,nullif(v_report.reporter_id,v_actor),coalesce(nullif(btrim(p_note),''),'Platform report '||p_decision),jsonb_build_object('report_id',v_report.id,'post_id',v_report.post_id,'reporter_id',v_report.reporter_id));
  return v_report;
end;
$$;

revoke all on function public.testagram_submit_moderation_appeal(text) from public,anon;
revoke all on function public.testagram_list_my_moderation_appeals() from public,anon;
revoke all on function public.testagram_list_pending_moderation_appeals(integer) from public,anon;
revoke all on function public.testagram_review_moderation_appeal(uuid,text,text) from public,anon;
revoke all on function public.testagram_list_platform_reports(text,integer) from public,anon;
revoke all on function public.testagram_resolve_platform_report(uuid,text,text) from public,anon;
grant execute on function public.testagram_submit_moderation_appeal(text) to authenticated;
grant execute on function public.testagram_list_my_moderation_appeals() to authenticated;
grant execute on function public.testagram_list_pending_moderation_appeals(integer) to authenticated;
grant execute on function public.testagram_review_moderation_appeal(uuid,text,text) to authenticated;
grant execute on function public.testagram_list_platform_reports(text,integer) to authenticated;
grant execute on function public.testagram_resolve_platform_report(uuid,text,text) to authenticated;
