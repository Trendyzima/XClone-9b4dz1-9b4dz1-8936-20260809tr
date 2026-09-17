-- Audio Spaces authorization hardening v1.
-- Additive migration: preserves the pre-existing monetization-aware audio_spaces schema.

alter table public.audio_spaces add column if not exists room_name text;
alter table public.audio_spaces add column if not exists description text not null default '';
alter table public.audio_spaces add column if not exists topic text not null default '';
alter table public.audio_spaces add column if not exists category text not null default 'general';
alter table public.audio_spaces add column if not exists language text not null default 'und';
alter table public.audio_spaces add column if not exists visibility text not null default 'public';
alter table public.audio_spaces add column if not exists scheduled_for timestamptz;
alter table public.audio_spaces add column if not exists updated_at timestamptz not null default now();
alter table public.audio_spaces add column if not exists max_audience integer not null default 1000;
alter table public.audio_spaces add column if not exists recording_enabled boolean not null default false;
alter table public.audio_spaces add column if not exists recording_consent_required boolean not null default true;
alter table public.audio_spaces add column if not exists listener_requests_enabled boolean not null default true;
alter table public.audio_spaces add column if not exists speaking_locked boolean not null default false;
update public.audio_spaces set room_name=coalesce(room_name,'space_'||id::text),updated_at=coalesce(updated_at,now()) where room_name is null;
alter table public.audio_spaces alter column room_name set not null;
create unique index if not exists audio_spaces_room_name_uidx on public.audio_spaces(room_name);

create table if not exists public.audio_space_participants (
  space_id uuid not null references public.audio_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'listener',
  state text not null default 'joined',
  muted boolean not null default false,
  hand_raised_at timestamptz,
  joined_at timestamptz,
  last_seen_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(space_id,user_id)
);

create table if not exists public.audio_space_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.audio_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null default 'speak',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create unique index if not exists audio_space_pending_request_uidx on public.audio_space_requests(space_id,user_id,request_type) where status='pending';

create table if not exists public.audio_space_events (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.audio_spaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audio_spaces_live_idx on public.audio_spaces(status,created_at desc);
create index if not exists audio_space_participants_user_idx on public.audio_space_participants(user_id,state);
create index if not exists audio_space_requests_pending_idx on public.audio_space_requests(space_id,status,created_at);
create index if not exists audio_space_events_space_idx on public.audio_space_events(space_id,created_at desc);

alter table public.audio_spaces enable row level security;
alter table public.audio_space_participants enable row level security;
alter table public.audio_space_requests enable row level security;
alter table public.audio_space_events enable row level security;

drop policy if exists audio_spaces_select on public.audio_spaces;
create policy audio_spaces_select on public.audio_spaces for select to authenticated using (
  visibility='public' or host_id=(select auth.uid()) or exists(select 1 from public.audio_space_participants p where p.space_id=id and p.user_id=(select auth.uid()) and p.state not in ('banned','removed'))
);
drop policy if exists audio_spaces_insert on public.audio_spaces;
create policy audio_spaces_insert on public.audio_spaces for insert to authenticated with check(host_id=(select auth.uid()));
drop policy if exists audio_spaces_update on public.audio_spaces;
create policy audio_spaces_update on public.audio_spaces for update to authenticated using(host_id=(select auth.uid())) with check(host_id=(select auth.uid()));

drop policy if exists audio_participants_select on public.audio_space_participants;
create policy audio_participants_select on public.audio_space_participants for select to authenticated using(
  user_id=(select auth.uid()) or exists(select 1 from public.audio_spaces s where s.id=space_id and s.host_id=(select auth.uid())) or exists(select 1 from public.audio_space_participants p where p.space_id=space_id and p.user_id=(select auth.uid()) and p.role in ('host','cohost'))
);
drop policy if exists audio_requests_select on public.audio_space_requests;
create policy audio_requests_select on public.audio_space_requests for select to authenticated using(
  user_id=(select auth.uid()) or exists(select 1 from public.audio_spaces s where s.id=space_id and s.host_id=(select auth.uid())) or exists(select 1 from public.audio_space_participants p where p.space_id=space_id and p.user_id=(select auth.uid()) and p.role in ('host','cohost'))
);
drop policy if exists audio_events_select on public.audio_space_events;
create policy audio_events_select on public.audio_space_events for select to authenticated using(
  exists(select 1 from public.audio_spaces s where s.id=space_id and s.host_id=(select auth.uid())) or exists(select 1 from public.audio_space_participants p where p.space_id=space_id and p.user_id=(select auth.uid()) and p.state not in ('banned','removed'))
);

create or replace function public.create_audio_space(p_title text,p_description text default '',p_topic text default '',p_visibility text default 'public',p_category text default 'general',p_language text default 'und',p_scheduled_for timestamptz default null,p_max_audience integer default 1000,p_recording_enabled boolean default false,p_listener_requests_enabled boolean default true) returns public.audio_spaces language plpgsql security invoker as $$ declare v public.audio_spaces; begin if auth.uid() is null then raise exception 'authentication_required'; end if; insert into public.audio_spaces(host_id,room_name,title,description,topic,visibility,category,language,status,scheduled_for,max_audience,recording_enabled,listener_requests_enabled) values(auth.uid(),'space_'||replace(gen_random_uuid()::text,'-',''),trim(p_title),coalesce(p_description,''),coalesce(p_topic,''),p_visibility,p_category,p_language,case when p_scheduled_for is null then 'draft' else 'scheduled' end,p_scheduled_for,p_max_audience,p_recording_enabled,p_listener_requests_enabled) returning * into v; insert into public.audio_space_participants(space_id,user_id,role,state,joined_at,last_seen_at) values(v.id,auth.uid(),'host','joined',now(),now()) on conflict do nothing; insert into public.audio_space_events(space_id,actor_id,event_type) values(v.id,auth.uid(),case when v.status='scheduled' then 'scheduled' else 'created' end); return v; end $$;

create or replace function public.join_audio_space(p_space_id uuid) returns public.audio_space_participants language plpgsql security invoker as $$ declare v public.audio_space_participants; s public.audio_spaces; begin if auth.uid() is null then raise exception 'authentication_required'; end if; select * into s from public.audio_spaces where id=p_space_id for update; if not found or s.status not in ('scheduled','live','paused') then raise exception 'space_not_joinable'; end if; if exists(select 1 from public.audio_space_participants where space_id=p_space_id and user_id=auth.uid() and state in ('banned','removed')) then raise exception 'access_denied'; end if; insert into public.audio_space_participants(space_id,user_id,role,state,joined_at,last_seen_at) values(p_space_id,auth.uid(),'listener','joined',now(),now()) on conflict(space_id,user_id) do update set state='joined',left_at=null,last_seen_at=now(),updated_at=now() returning * into v; insert into public.audio_space_events(space_id,actor_id,event_type) values(p_space_id,auth.uid(),'joined'); return v; end $$;

create or replace function public.request_audio_space_speak(p_space_id uuid) returns public.audio_space_requests language plpgsql security invoker as $$ declare v public.audio_space_requests; begin if not exists(select 1 from public.audio_spaces where id=p_space_id and status in ('live','paused') and listener_requests_enabled and not speaking_locked) then raise exception 'speaking_requests_disabled'; end if; if exists(select 1 from public.audio_space_participants where space_id=p_space_id and user_id=auth.uid() and state in ('banned','removed')) then raise exception 'access_denied'; end if; insert into public.audio_space_requests(space_id,user_id,request_type,status) values(p_space_id,auth.uid(),'speak','pending') on conflict do nothing returning * into v; if v.id is null then select * into v from public.audio_space_requests where space_id=p_space_id and user_id=auth.uid() and request_type='speak' and status='pending' limit 1; end if; insert into public.audio_space_events(space_id,actor_id,event_type) values(p_space_id,auth.uid(),'requested_speak'); return v; end $$;

create or replace function public.end_audio_space(p_space_id uuid) returns public.audio_spaces language plpgsql security invoker as $$ declare v public.audio_spaces; begin update public.audio_spaces set status='ended',ended_at=coalesce(ended_at,now()),updated_at=now() where id=p_space_id and host_id=auth.uid() and status not in ('ended','cancelled') returning * into v; if v.id is null then raise exception 'not_authorized_or_already_ended'; end if; insert into public.audio_space_events(space_id,actor_id,event_type) values(p_space_id,auth.uid(),'ended'); return v; end $$;

grant select,insert,update on public.audio_spaces to authenticated;
grant select on public.audio_space_participants,public.audio_space_requests,public.audio_space_events to authenticated;
grant execute on function public.create_audio_space(text,text,text,text,text,text,timestamptz,integer,boolean,boolean) to authenticated;
grant execute on function public.join_audio_space(uuid) to authenticated;
grant execute on function public.request_audio_space_speak(uuid) to authenticated;
grant execute on function public.end_audio_space(uuid) to authenticated;
