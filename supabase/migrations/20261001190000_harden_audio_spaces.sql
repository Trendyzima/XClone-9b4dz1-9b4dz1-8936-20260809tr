-- Audio Spaces forensic hardening: speaker workflow, audience cap, role security.
-- Applied to production Supabase before commit; keep this migration as the reproducible source of truth.

begin;

create table if not exists public.audio_space_speaker_requests (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  primary key (space_id, user_id),
  constraint audio_space_speaker_requests_status_check check (status in ('pending','approved','denied'))
);

alter table public.audio_space_speaker_requests enable row level security;
revoke all on table public.audio_space_speaker_requests from anon, authenticated;
grant select, insert on table public.audio_space_speaker_requests to authenticated;

drop policy if exists "space speaker requests read participants" on public.audio_space_speaker_requests;
create policy "space speaker requests read participants" on public.audio_space_speaker_requests
for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.spaces s where s.id = audio_space_speaker_requests.space_id and s.host_id = (select auth.uid()))
);

drop policy if exists "space speaker requests create own" on public.audio_space_speaker_requests;
create policy "space speaker requests create own" on public.audio_space_speaker_requests
for insert to authenticated with check (
  user_id = (select auth.uid()) and status = 'pending'
  and exists (
    select 1 from public.spaces s
    where s.id = audio_space_speaker_requests.space_id
      and s.is_live = true and s.listener_requests_enabled = true
      and s.host_id <> (select auth.uid())
  )
);

create or replace function public.join_audio_space(p_space_id uuid)
returns public.space_participants language plpgsql security definer set search_path = '' as $function$
declare
  result public.space_participants;
  v_user uuid := (select auth.uid());
  v_limit integer;
  v_active integer;
begin
  if v_user is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select s.max_audience into v_limit from public.spaces s
    where s.id = p_space_id and s.is_live = true and s.ended_at is null for update;
  if not found then raise exception 'SPACE_NOT_LIVE' using errcode='42501'; end if;

  select count(*)::integer into v_active from public.space_participants p
    where p.space_id = p_space_id and p.left_at is null;

  if exists (select 1 from public.space_participants p
      where p.space_id = p_space_id and p.user_id = v_user and p.left_at is null) then
    select * into result from public.space_participants p
      where p.space_id = p_space_id and p.user_id = v_user;
    return result;
  end if;

  if v_active >= greatest(1, coalesce(v_limit, 1000)) then
    raise exception 'SPACE_AUDIENCE_LIMIT_REACHED' using errcode='P0001';
  end if;

  insert into public.space_participants(space_id,user_id,joined_at,left_at,role)
    values (p_space_id,v_user,now(),null,'listener')
    on conflict (space_id,user_id) do update
      set joined_at=now(),left_at=null,role='listener'
    returning * into result;

  update public.spaces s set listener_count = (
    select count(*)::integer from public.space_participants p
    where p.space_id=s.id and p.left_at is null
  ) where s.id=p_space_id;
  return result;
end;
$function$;

create or replace function public.request_audio_space_speaker(p_space_id uuid)
returns public.audio_space_speaker_requests language plpgsql security definer set search_path = '' as $function$
declare result public.audio_space_speaker_requests; v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if not exists (select 1 from public.spaces s where s.id=p_space_id and s.is_live=true
      and s.ended_at is null and s.listener_requests_enabled=true) then
    raise exception 'SPEAKER_REQUESTS_DISABLED_OR_SPACE_NOT_LIVE' using errcode='42501';
  end if;
  if not exists (select 1 from public.space_participants p where p.space_id=p_space_id
      and p.user_id=v_user and p.left_at is null) then
    raise exception 'JOIN_SPACE_BEFORE_REQUESTING_SPEAKER' using errcode='42501';
  end if;

  insert into public.audio_space_speaker_requests(space_id,user_id,status)
    values(p_space_id,v_user,'pending')
    on conflict (space_id,user_id) do update
      set status='pending',requested_at=now(),decided_at=null,decided_by=null
    returning * into result;
  return result;
end;
$function$;

create or replace function public.decide_audio_space_speaker_request(p_space_id uuid,p_user_id uuid,p_decision text)
returns public.space_participants language plpgsql security definer set search_path = '' as $function$
declare
  result public.space_participants;
  v_host uuid := (select auth.uid());
  v_decision text := lower(trim(p_decision));
begin
  if not exists (select 1 from public.spaces s where s.id=p_space_id and s.host_id=v_host) then
    raise exception 'HOST_ONLY' using errcode='42501';
  end if;
  if v_decision not in ('approved','denied') then
    raise exception 'INVALID_SPEAKER_DECISION' using errcode='22023';
  end if;
  if not exists (select 1 from public.audio_space_speaker_requests r
      where r.space_id=p_space_id and r.user_id=p_user_id and r.status='pending') then
    raise exception 'SPEAKER_REQUEST_NOT_PENDING' using errcode='P0001';
  end if;

  update public.audio_space_speaker_requests
    set status=v_decision,decided_at=now(),decided_by=v_host
    where space_id=p_space_id and user_id=p_user_id;

  if v_decision='approved' then
    update public.space_participants set role='speaker'
      where space_id=p_space_id and user_id=p_user_id and left_at is null
      returning * into result;
    if not found then raise exception 'PARTICIPANT_NOT_ACTIVE' using errcode='P0001'; end if;
  else
    select * into result from public.space_participants p
      where p.space_id=p_space_id and p.user_id=p_user_id;
  end if;
  return result;
end;
$function$;

create or replace function public.revoke_audio_space_speaker(p_space_id uuid,p_user_id uuid)
returns public.space_participants language plpgsql security definer set search_path = '' as $function$
declare result public.space_participants; v_host uuid := (select auth.uid());
begin
  if not exists (select 1 from public.spaces s where s.id=p_space_id and s.host_id=v_host) then
    raise exception 'HOST_ONLY' using errcode='42501';
  end if;
  update public.space_participants set role='listener'
    where space_id=p_space_id and user_id=p_user_id and left_at is null
    returning * into result;
  if not found then raise exception 'PARTICIPANT_NOT_ACTIVE' using errcode='P0001'; end if;
  update public.audio_space_speaker_requests set status='denied',decided_at=now(),decided_by=v_host
    where space_id=p_space_id and user_id=p_user_id;
  return result;
end;
$function$;

create or replace function public.leave_audio_space(p_space_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_user uuid := (select auth.uid()); v_changed boolean := false;
begin
  if v_user is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  update public.space_participants set left_at=now()
    where space_id=p_space_id and user_id=v_user and left_at is null;
  v_changed := found;
  update public.spaces s set listener_count = (
    select count(*)::integer from public.space_participants p
    where p.space_id=s.id and p.left_at is null
  ) where s.id=p_space_id;
  return v_changed;
end;
$function$;

revoke all on function public.join_audio_space(uuid) from public,anon,authenticated;
revoke all on function public.request_audio_space_speaker(uuid) from public,anon,authenticated;
revoke all on function public.decide_audio_space_speaker_request(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.revoke_audio_space_speaker(uuid,uuid) from public,anon,authenticated;
revoke all on function public.leave_audio_space(uuid) from public,anon,authenticated;

grant execute on function public.join_audio_space(uuid) to authenticated;
grant execute on function public.request_audio_space_speaker(uuid) to authenticated;
grant execute on function public.decide_audio_space_speaker_request(uuid,uuid,text) to authenticated;
grant execute on function public.revoke_audio_space_speaker(uuid,uuid) to authenticated;
grant execute on function public.leave_audio_space(uuid) to authenticated;

revoke insert,update,delete on table public.space_participants from authenticated;
grant select on table public.space_participants to authenticated;

commit;
