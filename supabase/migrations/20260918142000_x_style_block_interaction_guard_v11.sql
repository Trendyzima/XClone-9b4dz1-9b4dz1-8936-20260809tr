-- X-style block interaction/follow guard v11
create or replace function public.testagram_accounts_blocked_between(p_a uuid,p_b uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id=p_a and ub.blocked_id=p_b)
       or (ub.blocker_id=p_b and ub.blocked_id=p_a)
  );
$$;
revoke all on function public.testagram_accounts_blocked_between(uuid,uuid) from public;
grant execute on function public.testagram_accounts_blocked_between(uuid,uuid) to anon,authenticated;

drop policy if exists follows_block_guard on public.follows;
create policy follows_block_guard on public.follows as restrictive
for all to authenticated
using (
  not public.testagram_accounts_blocked_between(auth.uid(),follows.following_id)
  and not public.testagram_accounts_blocked_between(auth.uid(),follows.follower_id)
)
with check (
  not public.testagram_accounts_blocked_between(auth.uid(),follows.following_id)
  and not public.testagram_accounts_blocked_between(auth.uid(),follows.follower_id)
);

drop policy if exists follow_requests_block_guard on public.follow_requests;
create policy follow_requests_block_guard on public.follow_requests as restrictive
for all to authenticated
using (
  not public.testagram_accounts_blocked_between(auth.uid(),follow_requests.target_id)
  and not public.testagram_accounts_blocked_between(auth.uid(),follow_requests.requester_id)
)
with check (
  not public.testagram_accounts_blocked_between(auth.uid(),follow_requests.target_id)
  and not public.testagram_accounts_blocked_between(auth.uid(),follow_requests.requester_id)
);

-- Keep follow RPC authoritative when a block exists.
create or replace function public.respond_follow_request(p_requester_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); current_status text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_requester_id is null or p_requester_id=u then raise exception 'INVALID_FOLLOW_REQUEST'; end if;
 if p_action not in ('accept','reject') then raise exception 'INVALID_FOLLOW_REQUEST_ACTION'; end if;
 if public.testagram_accounts_blocked_between(u,p_requester_id) then raise exception 'FOLLOW_BLOCKED'; end if;
 select status into current_status from public.follow_requests where requester_id=p_requester_id and target_id=u and status='pending' for update;
 if current_status is null then raise exception 'FOLLOW_REQUEST_NOT_FOUND'; end if;
 if p_action='accept' then
   update public.follow_requests set status='accepted' where requester_id=p_requester_id and target_id=u and status='pending';
   delete from public.follows where follower_id=p_requester_id and following_id=u;
   insert into public.follows(follower_id,following_id,status,accepted_at) values(p_requester_id,u,'accepted',now());
 else
   update public.follow_requests set status='declined' where requester_id=p_requester_id and target_id=u and status='pending';
   delete from public.follows where follower_id=p_requester_id and following_id=u;
 end if;
 return jsonb_build_object('requester_id',p_requester_id,'target_id',u,'action',p_action,'status',case when p_action='accept' then 'accepted' else 'declined' end);
end;
$$;
revoke all on function public.respond_follow_request(uuid,text) from public;
revoke all on function public.respond_follow_request(uuid,text) from anon;
grant execute on function public.respond_follow_request(uuid,text) to authenticated;
