-- Atomic local reply creation and durable count reconciliation.
create or replace function public.testagram_create_local_reply(p_post_id uuid,p_content text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user uuid:=auth.uid(); v_content text:=btrim(coalesce(p_content,'')); v_id uuid; v_count bigint;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 if v_content='' then raise exception using errcode='22023',message='Reply content is required'; end if;
 if length(v_content)>10000 then raise exception using errcode='22023',message='Reply is too long'; end if;
 if not exists(select 1 from public.posts where id=p_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Post not found'; end if;
 insert into public.replies(post_id,user_id,content) values(p_post_id,v_user,v_content) returning id into v_id;
 select count(*) into v_count from public.replies where post_id=p_post_id;
 update public.posts set replies_count=v_count,updated_at=now() where id=p_post_id;
 return jsonb_build_object('reply_id',v_id,'created',true,'replies_count',v_count);
end $$;
grant execute on function public.testagram_create_local_reply(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.capability_dispatch(p_capability text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_q text := btrim(coalesce(p_input->>'q',''));
  v_limit integer := least(100,greatest(1,coalesce((p_input->>'limit')::integer,20)));
  v_target_id uuid;
  v_post_id uuid;
  v_following boolean := false;
  v_requested boolean := false;
  v_status text;
  v_enabled boolean := coalesce((p_input->>'enabled')::boolean,true);
  v_content text := btrim(coalesce(p_input->>'content',''));
  v_emoji text := coalesce(nullif(p_input->>'emoji',''),'❤️');
  v_liked boolean := false;
  v_reposted boolean := false;
  v_like_count bigint := 0;
  v_repost_count bigint := 0;
  v_reply_count bigint := 0;
  v_reply_id uuid;
begin
  p_capability := btrim(coalesce(p_capability,''));
  if p_capability in ('testagram.capabilities.list','testagram.health.read') then
    null;
  elsif v_user_id is null then
    raise exception using errcode='28000',message='Authentication required';
  end if;

  case p_capability
    when 'testagram.capabilities.list' then
      return jsonb_build_object('capabilities',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.capability_registry c where c.enabled=true),'[]'::jsonb));
    when 'testagram.health.read' then
      return jsonb_build_object('services',jsonb_build_array(jsonb_build_object('service','database','status','ok'),jsonb_build_object('service','capability-gateway','status','ok')));

    when 'testagram.search.hashtags' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by lower(s.tag),s.id) from (
        select h.id,h.tag,h.usage_count,h.post_count,h.follower_count,h.last_used_at,h.created_at
        from public.hashtags h
        where v_q='' or position(lower(replace(v_q,'#','')) in lower(h.tag))>0
        order by h.usage_count desc nulls last,h.last_used_at desc nulls last,lower(h.tag),h.id
        limit v_limit) s),'[]'::jsonb),'next_cursor',null);

    when 'testagram.search.users' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by lower(s.username),s.id) from (
        select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified_tier,p.verified,p.follower_count,p.following_count,p.posts_count as post_count,p.protected_account,p.created_at
        from public.profiles p where p.account_status='active' and p.discoverable_by_username=true and
        (v_q='' or position(lower(v_q) in lower(p.username))>0 or position(lower(v_q) in lower(coalesce(p.display_name,'')))>0)
        order by lower(p.username),p.id limit v_limit) s),'[]'::jsonb),'next_cursor',null);

    when 'testagram.follows.state' then
      begin v_target_id:=(p_input->>'user_id')::uuid; exception when invalid_text_representation then raise exception using errcode='22023',message='Valid user_id is required'; end;
      select f.status into v_status from public.follows f where f.follower_id=v_user_id and f.following_id=v_target_id limit 1;
      v_following:=coalesce(v_status='accepted',false); v_requested:=coalesce(v_status='pending',false);
      return jsonb_build_object('state',jsonb_build_object('following',v_following,'requested',v_requested,'status',v_status));

    when 'testagram.follows.set' then
      begin v_target_id:=(p_input->>'user_id')::uuid; exception when invalid_text_representation then raise exception using errcode='22023',message='Valid user_id is required'; end;
      if v_target_id=v_user_id then raise exception using errcode='22023',message='Cannot follow yourself'; end if;
      if coalesce((p_input->>'follow')::boolean,true) then
        insert into public.follows(follower_id,following_id,status)
        select v_user_id,v_target_id,case when coalesce(p.protected_account,false) then 'pending' else 'accepted' end
        from public.profiles p where p.id=v_target_id and p.account_status='active'
        on conflict(follower_id,following_id) do update set status=excluded.status,updated_at=now();
        if not found then raise exception using errcode='P0002',message='Target profile not found'; end if;
      else
        delete from public.follows where follower_id=v_user_id and following_id=v_target_id;
      end if;
      select f.status into v_status from public.follows f where f.follower_id=v_user_id and f.following_id=v_target_id limit 1;
      return jsonb_build_object('state',jsonb_build_object('following',coalesce(v_status='accepted',false),'requested',coalesce(v_status='pending',false),'status',v_status));

    when 'testagram.posts.like' then
      return public.testagram_toggle_local_like((p_input->>'post_id')::uuid);

    when 'testagram.posts.like.state' then
      begin v_post_id:=(p_input->>'post_id')::uuid; exception when invalid_text_representation then raise exception using errcode='22023',message='Valid post_id is required'; end;
      select exists(select 1 from public.post_reactions where post_id=v_post_id and user_id=v_user_id and emoji='❤️') into v_liked;
      select likes_count into v_like_count from public.posts where id=v_post_id;
      return jsonb_build_object('state',jsonb_build_object('is_liked',coalesce(v_liked,false),'likes_count',coalesce(v_like_count,0)));

    when 'testagram.posts.repost' then
      return public.testagram_toggle_local_repost((p_input->>'post_id')::uuid);

    when 'testagram.posts.repost.state' then
      begin v_post_id:=(p_input->>'post_id')::uuid; exception when invalid_text_representation then raise exception using errcode='22023',message='Valid post_id is required'; end;
      select exists(select 1 from public.reposts where post_id=v_post_id and user_id=v_user_id) into v_reposted;
      select reposts_count into v_repost_count from public.posts where id=v_post_id;
      return jsonb_build_object('state',jsonb_build_object('is_reposted',coalesce(v_reposted,false),'reposts_count',coalesce(v_repost_count,0)));

    when 'testagram.replies.create' then
      return public.testagram_create_local_reply((p_input->>'post_id')::uuid,p_input->>'content');

    when 'testagram.replies.list' then
      begin v_post_id:=(p_input->>'post_id')::uuid; exception when invalid_text_representation then raise exception using errcode='22023',message='Valid post_id is required'; end;
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc) from (
        select r.id,r.post_id,r.user_id,r.content,r.created_at,r.updated_at,
               jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url) as profile
        from public.replies r join public.profiles p on p.id=r.user_id
        where r.post_id=v_post_id order by r.created_at desc,r.id desc limit v_limit) s),'[]'::jsonb),'next_cursor',null);

    else
      raise exception using errcode='0A000',message='Capability not implemented: '||p_capability;
  end case;
end;
$function$

