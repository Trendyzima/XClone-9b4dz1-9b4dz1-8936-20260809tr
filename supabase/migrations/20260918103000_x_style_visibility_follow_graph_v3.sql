-- Canonical X-style visibility + protected follow graph alignment.
-- The capability dispatcher is already visibility-gated by the prior public-discovery
-- migration; this migration hardens recommendation materialization and follow state.

create or replace function public.set_follow_state(p_following_id uuid, p_follow boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); is_protected boolean; new_status text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_following_id is null or p_following_id=u then raise exception 'INVALID_FOLLOW_TARGET'; end if;
 select protected_account into is_protected from public.profiles where id=p_following_id;
 if is_protected is null then raise exception 'PROFILE_NOT_FOUND'; end if;
 if not p_follow then
   delete from public.follow_requests where requester_id=u and target_id=p_following_id;
   delete from public.follows where follower_id=u and following_id=p_following_id;
   return jsonb_build_object('following',false,'requested',false,'status','none','following_id',p_following_id);
 end if;
 if is_protected then
   insert into public.follow_requests(requester_id,target_id,status) values(u,p_following_id,'pending')
   on conflict(requester_id,target_id) do update set status='pending',created_at=now();
   insert into public.follows(follower_id,following_id,status,accepted_at) values(u,p_following_id,'pending',null)
   on conflict(follower_id,following_id) do update set status='pending',accepted_at=null;
   new_status:='pending';
 else
   delete from public.follow_requests where requester_id=u and target_id=p_following_id;
   insert into public.follows(follower_id,following_id,status,accepted_at) values(u,p_following_id,'accepted',now())
   on conflict(follower_id,following_id) do update set status='accepted',accepted_at=now();
   new_status:='accepted';
 end if;
 return jsonb_build_object('following',new_status='accepted','requested',new_status='pending','status',new_status,'following_id',p_following_id);
end $$;

revoke all on function public.set_follow_state(uuid,boolean) from public;
grant execute on function public.set_follow_state(uuid,boolean) to authenticated;

create or replace function public.get_follow_state(p_following_id uuid)
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
 'following',coalesce((select f.status='accepted' from public.follows f where f.follower_id=auth.uid() and f.following_id=p_following_id),false),
 'requested',coalesce((select f.status='pending' from public.follows f where f.follower_id=auth.uid() and f.following_id=p_following_id),false),
 'followed_by',coalesce((select f.status='accepted' from public.follows f where f.follower_id=p_following_id and f.following_id=auth.uid()),false),
 'status',coalesce((select f.status from public.follows f where f.follower_id=auth.uid() and f.following_id=p_following_id),'none'),
 'following_id',p_following_id);
$$;
revoke all on function public.get_follow_state(uuid) from public;
grant execute on function public.get_follow_state(uuid) to authenticated;

do $$
declare src text; patched text;
begin
 select pg_get_functiondef(p.oid) into src
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='generate_content_recommendations'
 limit 1;
 if src is null then raise exception 'generate_content_recommendations not found'; end if;
 patched:=replace(src,
   'where p.deleted_at is null and p.community_id is null and p.visibility = ''public''',
   'where p.deleted_at is null and public.testagram_post_is_visible_to_viewer(p.id,p_user_id) and p.community_id is null and p.visibility = ''public'''
 );
 if patched<>src then execute patched; end if;
end $$;
