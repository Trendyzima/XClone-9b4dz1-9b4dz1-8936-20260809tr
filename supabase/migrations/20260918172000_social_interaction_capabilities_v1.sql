-- Canonical like/repost state and reply capabilities.
do $body$
declare src text; old text; new text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch_core' limit 1;
 if src is null then raise exception 'CAPABILITY_DISPATCH_CORE_NOT_FOUND'; end if;
 old:=$old$ when 'testagram.posts.like' then return to_jsonb(public.toggle_post_like((p_input->>'post_id')::uuid));
 when 'testagram.posts.repost' then return to_jsonb(public.toggle_post_repost((p_input->>'post_id')::uuid));
$old$;
 new:=$new$ when 'testagram.posts.like' then return to_jsonb(public.toggle_post_like((p_input->>'post_id')::uuid));
 when 'testagram.posts.like.state' then
   v_id:=(p_input->>'post_id')::uuid;
   if not public.testagram_post_is_visible_to_viewer(v_id,u) then raise exception 'POST_NOT_VISIBLE'; end if;
   return jsonb_build_object('state',jsonb_build_object('is_liked',exists(select 1 from public.post_likes where post_id=v_id and user_id=u),'likes_count',(select count(*)::bigint from public.post_likes where post_id=v_id)));
 when 'testagram.posts.repost' then return to_jsonb(public.toggle_post_repost((p_input->>'post_id')::uuid));
 when 'testagram.posts.repost.state' then
   v_id:=(p_input->>'post_id')::uuid;
   if not public.testagram_post_is_visible_to_viewer(v_id,u) then raise exception 'POST_NOT_VISIBLE'; end if;
   return jsonb_build_object('state',jsonb_build_object('is_reposted',exists(select 1 from public.post_reposts where post_id=v_id and user_id=u),'reposts_count',(select count(*)::bigint from public.post_reposts where post_id=v_id)));
 when 'testagram.replies.list' then
   v_id:=(p_input->>'post_id')::uuid;
   if not public.testagram_post_is_visible_to_viewer(v_id,u) then raise exception 'POST_NOT_VISIBLE'; end if;
   select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]') into v from (select r.*,jsonb_build_object('id',pr.id,'username',pr.username,'avatar_url',pr.avatar_url,'verified_tier',pr.verified_tier) profile from public.replies r join public.profiles pr on pr.id=r.user_id where r.post_id=v_id and public.testagram_profile_is_visible_to_viewer(r.user_id) order by r.created_at asc limit v_limit) x;
   return jsonb_build_object('items',v);
 when 'testagram.replies.create' then
   v_id:=(p_input->>'post_id')::uuid;
   if not public.testagram_post_is_interactable_to_viewer(v_id,u) then raise exception 'POST_NOT_INTERACTABLE'; end if;
   insert into public.replies(post_id,user_id,content) values(v_id,u,trim(coalesce(p_input->>'content',''))) returning id into v_id;
   return jsonb_build_object('reply_id',v_id,'created',true);
$new$;
 if position(old in src)=0 then raise exception 'SOCIAL_CAPABILITY_ANCHOR_NOT_FOUND'; end if;
 execute replace(src,old,new);
end $body$;

insert into public.capability_registry(name,version,access,readonly,description,enabled) values
('testagram.posts.like.state',1,'authenticated',true,'Read the caller like state for a visible post.',true),
('testagram.posts.repost.state',1,'authenticated',true,'Read the caller repost state for a visible post.',true),
('testagram.replies.list',1,'authenticated',true,'List visible replies for a post.',true),
('testagram.replies.create',1,'authenticated',false,'Create a reply through canonical post interaction rules.',true)
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=true,updated_at=now();
