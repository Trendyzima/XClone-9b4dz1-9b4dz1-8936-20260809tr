-- Canonical Audio Space host capability.
-- Platform owners may host without verification; all other hosts require verified=true.
-- The UI consumes this capability, while create/start enforce the same rule server-side.

create or replace function public.get_audio_space_host_capability()
returns table(can_host boolean, is_owner boolean, is_verified boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (public.testagram_is_owner() or coalesce(p.verified,false)) as can_host,
    public.testagram_is_owner() as is_owner,
    coalesce(p.verified,false) as is_verified
  from public.profiles p
  where p.id=(select auth.uid());
$$;

revoke all on function public.get_audio_space_host_capability() from public;
grant execute on function public.get_audio_space_host_capability() to authenticated;

create or replace function public.create_audio_space(
  p_title text,
  p_description text default null,
  p_topic text default '',
  p_visibility text default 'public',
  p_category text default 'general',
  p_language text default 'und',
  p_scheduled_for timestamptz default null,
  p_max_audience integer default 1000,
  p_recording_enabled boolean default false,
  p_listener_requests_enabled boolean default true
) returns public.spaces
language plpgsql
security invoker
set search_path=public
as $$
declare
  result public.spaces;
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id=v_user
      and (coalesce(p.verified,false) or public.testagram_is_owner())
  ) then
    raise exception 'AUDIO_SPACE_HOST_NOT_ELIGIBLE' using errcode='42501';
  end if;
  if nullif(trim(p_title),'') is null then
    raise exception 'SPACE_TITLE_REQUIRED' using errcode='22023';
  end if;

  insert into public.spaces(
    host_id,title,description,is_live,listener_count,category,subscriber_only,room_name,
    topic,language,scheduled_for,max_audience,recording_enabled,listener_requests_enabled
  )
  values(
    v_user,trim(p_title),p_description,false,0,nullif(trim(p_category),''),
    case when lower(coalesce(p_visibility,'public'))='subscribers' then true else false end,
    null,coalesce(p_topic,''),coalesce(p_language,'und'),p_scheduled_for,
    greatest(1,coalesce(p_max_audience,1000)),coalesce(p_recording_enabled,false),
    coalesce(p_listener_requests_enabled,true)
  )
  returning * into result;
  return result;
end;
$$;

grant execute on function public.create_audio_space(text,text,text,text,text,text,timestamptz,integer,boolean,boolean) to authenticated;

create or replace function public.start_audio_space(p_space_id uuid)
returns public.spaces
language plpgsql
security invoker
set search_path=public
as $$
declare
  result public.spaces;
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id=v_user
      and (coalesce(p.verified,false) or public.testagram_is_owner())
  ) then
    raise exception 'AUDIO_SPACE_HOST_NOT_ELIGIBLE' using errcode='42501';
  end if;

  update public.spaces
  set is_live=true, started_at=coalesce(started_at,now()), ended_at=null
  where id=p_space_id and host_id=v_user
  returning * into result;

  if not found then
    raise exception 'SPACE_NOT_FOUND_OR_FORBIDDEN' using errcode='42501';
  end if;
  return result;
end;
$$;

grant execute on function public.start_audio_space(uuid) to authenticated;
