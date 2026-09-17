-- Runtime hardening applied live: request RPC becomes server-authoritative and speak-request IDs use the canonical UUID type.
create or replace function public.request_audio_space_speak(p_space_id uuid) returns public.audio_space_requests language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid(); s public.audio_spaces; r public.audio_space_requests;
begin
 if u is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into s from public.audio_spaces where id=p_space_id;
 if s.id is null then raise exception 'SPACE_NOT_FOUND' using errcode='P0002'; end if;
 if s.status not in ('live','paused') then raise exception 'SPACE_NOT_LIVE' using errcode='40901'; end if;
 if not s.listener_requests_enabled or s.speaking_locked then raise exception 'SPEAK_REQUESTS_DISABLED' using errcode='40901'; end if;
 if exists(select 1 from public.audio_space_participants p where p.space_id=p_space_id and p.user_id=u and p.state in ('banned','removed')) then raise exception 'SPACE_ACCESS_DENIED' using errcode='42501'; end if;
 insert into public.audio_space_participants(space_id,user_id,role,state,joined_at,last_seen_at,created_at,updated_at) values(p_space_id,u,'listener','joined',now(),now(),now(),now()) on conflict(space_id,user_id) do update set state='joined',last_seen_at=now(),updated_at=now();
 insert into public.audio_space_requests(space_id,user_id,request_type,status,created_at) values(p_space_id,u,'speak','pending',now()) on conflict do nothing returning * into r;
 if r.id is null then select * into r from public.audio_space_requests where space_id=p_space_id and user_id=u and request_type='speak' and status='pending' order by created_at desc limit 1; end if;
 perform audio_space_private.log_event(p_space_id,u,null,'requested_speak'); return r;
end $$;
grant execute on function public.request_audio_space_speak(uuid) to authenticated;

drop function if exists public.resolve_audio_space_speak_request(bigint,boolean);
create or replace function public.resolve_audio_space_speak_request(p_request_id uuid,p_approve boolean) returns public.audio_space_requests language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid(); q public.audio_space_requests; r public.audio_space_requests;
begin
 if u is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into q from public.audio_space_requests where id=p_request_id;
 if q.id is null then raise exception 'REQUEST_NOT_FOUND' using errcode='P0002'; end if;
 if not audio_space_private.require_manager(q.space_id,u) then raise exception 'NOT_SPACE_MANAGER' using errcode='42501'; end if;
 update public.audio_space_requests set status=case when p_approve then 'approved' else 'rejected' end,resolved_at=now(),resolved_by=u where id=p_request_id and status='pending' returning * into r;
 if r.id is null then return q; end if;
 if p_approve then update public.audio_space_participants set role='speaker',state='joined',updated_at=now() where space_id=q.space_id and user_id=q.user_id and state not in ('banned','removed'); end if;
 perform audio_space_private.log_event(q.space_id,u,q.user_id,case when p_approve then 'speak_request_approved' else 'speak_request_rejected' end); return r;
end $$;
grant execute on function public.resolve_audio_space_speak_request(uuid,boolean) to authenticated;

-- v4 ambiguity fix for the capability function.
create or replace function public.get_audio_space_capability(p_space_id uuid) returns table(space_id uuid,room_name text,role text,state text,muted boolean,can_publish boolean,can_subscribe boolean,can_publish_data boolean) language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid(); s public.audio_spaces; p public.audio_space_participants;
begin
 if u is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into s from public.audio_spaces s0 where s0.id=p_space_id;
 if s.id is null then raise exception 'SPACE_NOT_FOUND' using errcode='P0002'; end if;
 select * into p from public.audio_space_participants p0 where p0.space_id=p_space_id and p0.user_id=u;
 if p.user_id is null or p.state in ('banned','removed','left') then raise exception 'SPACE_ACCESS_DENIED' using errcode='42501'; end if;
 if s.status='ended' then raise exception 'SPACE_ENDED' using errcode='40901'; end if;
 return query select s.id,s.room_name,p.role,p.state,p.muted,(p.role in ('host','cohost','speaker') and not p.muted and not s.speaking_locked),(s.status in ('live','paused','scheduled')),(p.role in ('host','cohost','speaker'));
end $$;