-- Align the canonical capability dispatcher with the social visibility contract.
-- This migration is intentionally patch-based so it preserves unrelated capability cases.

do $$
declare src text; patched text;
begin
 select pg_get_functiondef(p.oid) into src
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='capability_dispatch' limit 1;
 if src is null then raise exception 'capability_dispatch not found'; end if;

 -- Anonymous profile timelines are allowed; the canonical post predicate still
 -- decides which individual posts can cross the boundary.
 patched:=replace(src,
 'if u is null and p_capability not in (''testagram.search.users'',''testagram.search.posts'',''testagram.search.hashtags'',''testagram.search.communities'',''testagram.trends.list'') then',
 'if u is null and p_capability not in (''testagram.search.users'',''testagram.search.posts'',''testagram.search.hashtags'',''testagram.search.communities'',''testagram.trends.list'',''testagram.profile.timeline'') then'
 );

 -- posts.list: never return a post without crossing the canonical predicate.
 patched:=replace(patched,
 'from public.posts p where p.deleted_at is null order by p.created_at desc limit v_limit offset v_offset',
 'from public.posts p where public.testagram_post_is_visible_to_viewer(p.id,u) order by p.created_at desc limit v_limit offset v_offset'
 );

 -- search.posts: same predicate, plus the explicit public identity projection.
 patched:=replace(patched,
 'where p.deleted_at is null and pr.discoverable_by_username=true and',
 'where public.testagram_post_is_visible_to_viewer(p.id,u) and pr.discoverable_by_username=true and'
 );

 -- Recommendation read/materialization must both be protected.
 patched:=replace(patched,
 'from public.content_recommendations where user_id=u order by score desc,created_at desc limit v_limit',
 'from public.content_recommendations where user_id=u and public.testagram_post_is_visible_to_viewer(recommended_post_id,u) order by score desc,created_at desc limit v_limit'
 );

 -- Add the protected-profile timeline capability if it is not already present.
 if patched not like '%when ''testagram.profile.timeline'' then%' then
   patched:=replace(patched,
   'when ''testagram.posts.create'' then',
   'when ''testagram.profile.timeline'' then
     v_id:=(p_input->>''user_id'')::uuid;
     if v_id is null then raise exception ''PROFILE_ID_REQUIRED''; end if;
     select coalesce(jsonb_agg(to_jsonb(x)),''[]'') into v from (
       select p.id,p.author_id,p.user_id,p.body,p.content,p.created_at,p.updated_at,p.media_url,p.media_type,p.media_count,p.media_urls,p.image_url,p.video_url,p.is_video,p.likes_count,p.reposts_count,p.replies_count,p.views_count,p.community_id,
         jsonb_build_object(''id'',pr.id,''username'',pr.username,''display_name'',pr.display_name,''avatar_url'',pr.avatar_url,''bio'',pr.bio,''verified_tier'',pr.verified_tier,''follower_count'',pr.follower_count,''following_count'',pr.following_count,''protected_account'',pr.protected_account,''created_at'',pr.created_at) as user_profile
       from public.posts p join public.profiles pr on pr.id=coalesce(p.author_id,p.user_id)
       where coalesce(p.author_id,p.user_id)=v_id
         and public.testagram_post_is_visible_to_viewer(p.id,u)
       order by p.created_at desc limit v_limit offset v_offset
     ) x;
     return jsonb_build_object(''items'',v,''next_cursor'',case when jsonb_array_length(v)=v_limit then (v_offset+v_limit)::text else null end);

  when ''testagram.posts.create'' then'
   );
 end if;

 -- Follow-request listing/response is kept in the authenticated dispatcher.
 if patched not like '%when ''testagram.follow_requests.list'' then%' then
   patched:=replace(patched,
   'when ''testagram.follows.state'' then',
   'when ''testagram.follow_requests.list'' then
     select coalesce(jsonb_agg(to_jsonb(x)),''[]'') into v from (
       select fr.requester_id,fr.target_id,fr.status,fr.created_at,
         jsonb_build_object(''id'',pr.id,''username'',pr.username,''display_name'',pr.display_name,''avatar_url'',pr.avatar_url) requester
       from public.follow_requests fr join public.profiles pr on pr.id=fr.requester_id
       where fr.target_id=u and fr.status=''pending''
       order by fr.created_at desc limit v_limit offset v_offset
     ) x;
     return jsonb_build_object(''items'',v,''next_cursor'',case when jsonb_array_length(v)=v_limit then (v_offset+v_limit)::text else null end);

   when ''testagram.follow_requests.respond'' then
     v_id:=(p_input->>''requester_id'')::uuid;
     if p_input->>''action'' not in (''accept'',''reject'') then raise exception ''INVALID_FOLLOW_REQUEST_ACTION''; end if;
     if not exists(select 1 from public.follow_requests fr where fr.requester_id=v_id and fr.target_id=u and fr.status=''pending'') then raise exception ''FOLLOW_REQUEST_NOT_FOUND''; end if;
     if p_input->>''action''=''accept'' then
       update public.follow_requests set status=''accepted'' where requester_id=v_id and target_id=u and status=''pending'';
       insert into public.follows(follower_id,following_id,status,accepted_at) values(v_id,u,''accepted'',now())
       on conflict(follower_id,following_id) do update set status=''accepted'',accepted_at=now();
     else
       update public.follow_requests set status=''rejected'' where requester_id=v_id and target_id=u and status=''pending'';
       delete from public.follows where follower_id=v_id and following_id=u;
     end if;
     return jsonb_build_object(''requester_id'',v_id,''target_id'',u,''action'',p_input->>''action'',''status'',case when p_input->>''action''=''accept'' then ''accepted'' else ''rejected'' end);

   when ''testagram.follows.state'' then'
   );
 end if;

 if patched=src then
   -- Idempotent reruns are acceptable once all anchors are already present.
   if src not like '%testagram_post_is_visible_to_viewer%' then
     raise exception 'No dispatcher visibility anchors matched';
   end if;
 else
   execute patched;
 end if;
end $$;
