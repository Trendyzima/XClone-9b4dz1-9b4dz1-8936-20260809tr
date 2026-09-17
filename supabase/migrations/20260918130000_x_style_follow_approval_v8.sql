-- Close protected-follow approval boundary.
-- An accepted follows row for a protected account is valid only after the
-- corresponding owner-approved follow request exists.

create or replace function public.enforce_follow_protection()
returns trigger
language plpgsql
security definer
set search_path=public
as $function$
begin
  if new.status='accepted'
     and coalesce((select protected_account from public.profiles where id=new.following_id),false)
     and not exists (
       select 1 from public.follow_requests fr
       where fr.requester_id=new.follower_id
         and fr.target_id=new.following_id
         and fr.status='accepted'
     )
  then
    new.status:='pending';
    new.accepted_at:=null;
  end if;
  return new;
end;
$function$;

create or replace function public.respond_follow_request(p_requester_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  u uuid:=auth.uid();
  current_status text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_requester_id is null or p_requester_id=u then raise exception 'INVALID_FOLLOW_REQUEST'; end if;
  if p_action not in ('accept','reject') then raise exception 'INVALID_FOLLOW_REQUEST_ACTION'; end if;
  select status into current_status
  from public.follow_requests
  where requester_id=p_requester_id and target_id=u and status='pending'
  for update;
  if current_status is null then raise exception 'FOLLOW_REQUEST_NOT_FOUND'; end if;

  if p_action='accept' then
    update public.follow_requests set status='accepted'
      where requester_id=p_requester_id and target_id=u and status='pending';
    delete from public.follows
      where follower_id=p_requester_id and following_id=u;
    insert into public.follows(follower_id,following_id,status,accepted_at)
      values(p_requester_id,u,'accepted',now());
  else
    update public.follow_requests set status='declined'
      where requester_id=p_requester_id and target_id=u and status='pending';
    delete from public.follows
      where follower_id=p_requester_id and following_id=u;
  end if;

  return jsonb_build_object(
    'requester_id',p_requester_id,
    'target_id',u,
    'action',p_action,
    'status',case when p_action='accept' then 'accepted' else 'declined' end
  );
end;
$function$;

revoke all on function public.respond_follow_request(uuid,text) from public;
revoke all on function public.respond_follow_request(uuid,text) from anon;
grant execute on function public.respond_follow_request(uuid,text) to authenticated;

do $$
declare src text; old text; new text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='capability_dispatch' limit 1;

  old:=$old$
  when 'testagram.follow_requests.respond' then
    v_id:=(p_input->>'requester_id')::uuid;
    if p_input->>'action' not in ('accept','reject') then raise exception 'INVALID_FOLLOW_REQUEST_ACTION'; end if;
    if not exists(select 1 from public.follow_requests fr where fr.requester_id=v_id and fr.target_id=u and fr.status='pending') then raise exception 'FOLLOW_REQUEST_NOT_FOUND'; end if;
    if p_input->>'action'='accept' then
      update public.follow_requests set status='accepted' where requester_id=v_id and target_id=u and status='pending';
      insert into public.follows(follower_id,following_id,status,accepted_at) values(v_id,u,'accepted',now())
      on conflict(follower_id,following_id) do update set status='accepted',accepted_at=now();
    else
      update public.follow_requests set status='rejected' where requester_id=v_id and target_id=u and status='pending';
      delete from public.follows where follower_id=v_id and following_id=u;
    end if;
    return jsonb_build_object('requester_id',v_id,'target_id',u,'action',p_input->>'action',
      'status',case when p_input->>'action'='accept' then 'accepted' else 'rejected' end);
$old$;

  new:=$new$
  when 'testagram.follow_requests.respond' then
    v_id:=(p_input->>'requester_id')::uuid;
    if p_input->>'action' not in ('accept','reject') then raise exception 'INVALID_FOLLOW_REQUEST_ACTION'; end if;
    return public.respond_follow_request(v_id,p_input->>'action');
$new$;

  if position(old in src)=0 then raise exception 'FOLLOW_RESPOND_BRANCH_NOT_FOUND'; end if;
  execute replace(src,old,new);
end $$;