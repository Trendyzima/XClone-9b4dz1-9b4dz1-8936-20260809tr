create or replace function public.capability_dispatch(
  p_capability text,
  p_input jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_q text := btrim(coalesce(p_input->>'q',''));
  v_limit integer := least(100,greatest(1,coalesce((p_input->>'limit')::integer,20)));
  v_target_id uuid; v_following boolean := false; v_requested boolean := false; v_status text;
begin
  p_capability := btrim(coalesce(p_capability,''));
  if p_capability in ('testagram.capabilities.list','testagram.health.read') then null;
  elsif v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  case p_capability
    when 'testagram.capabilities.list' then
      return jsonb_build_object('capabilities',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.capability_registry c where c.enabled=true),'[]'::jsonb));
    when 'testagram.health.read' then
      return jsonb_build_object('services',jsonb_build_array(jsonb_build_object('service','database','status','ok'),jsonb_build_object('service','capability-gateway','status','ok')));
    when 'testagram.search.users' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by lower(s.username),s.id) from (
        select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified_tier,p.verified,p.follower_count,p.following_count,p.posts_count as post_count,p.protected_account,p.created_at,p.profile_features
        from public.profiles p where p.account_status='active' and p.discoverable_by_username=true
        and (v_q='' or position(lower(v_q) in lower(p.username))>0 or position(lower(v_q) in lower(coalesce(p.display_name,'')))>0)
        order by lower(p.username),p.id limit v_limit
      ) s),'[]'::jsonb),'next_cursor',null);
    when 'testagram.profile.timeline' then
      begin v_target_id := (p_input->>'user_id')::uuid;
      exception when invalid_text_representation then raise exception using errcode='22023',message='Valid user_id is required'; end;
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc) from (
        select p.id,p.user_id,p.content,p.image_url,p.video_url,p.is_video,p.is_long_form,p.is_monetized,p.price,p.community_id,p.media_urls,p.media_count,p.views_count,p.likes_count,p.reposts_count,p.replies_count,p.created_at,p.edited_at,p.edit_history,p.is_boosted,p.boost_type,
        jsonb_build_object('id',pr.id,'username',pr.username,'email',coalesce(pr.email,''),'avatar_url',pr.avatar_url,'bio',coalesce(pr.bio,''),'verified',coalesce(pr.verified,false),'follower_count',coalesce(pr.follower_count,0),'following_count',coalesce(pr.following_count,0),'created_at',pr.created_at) as user_profiles
        from public.posts p join public.profiles pr on pr.id=p.user_id
        where p.user_id=v_target_id and p.deleted_at is null
        order by p.created_at desc,p.id desc limit v_limit
      ) s),'[]'::jsonb),'next_cursor',null);
    when 'testagram.follows.state' then
      begin v_target_id := (p_input->>'user_id')::uuid;
      exception when invalid_text_representation then raise exception using errcode='22023',message='Valid user_id is required'; end;
      select f.status into v_status from public.follows f where f.follower_id=v_user_id and f.following_id=v_target_id limit 1;
      return jsonb_build_object('state',jsonb_build_object('following',coalesce(v_status='accepted',false),'requested',coalesce(v_status='pending',false),'status',v_status));
    when 'testagram.follows.set' then
      begin v_target_id := (p_input->>'user_id')::uuid;
      exception when invalid_text_representation then raise exception using errcode='22023',message='Valid user_id is required'; end;
      if v_target_id=v_user_id then raise exception using errcode='22023',message='Cannot follow yourself'; end if;
      if coalesce((p_input->>'follow')::boolean,true) then
        insert into public.follows(follower_id,following_id,status)
        select v_user_id,v_target_id,case when coalesce(p.protected_account,false) then 'pending' else 'accepted' end from public.profiles p where p.id=v_target_id and p.account_status='active'
        on conflict (follower_id,following_id) do update set status=excluded.status,updated_at=now();
        if not found then raise exception using errcode='P0002',message='Target profile not found'; end if;
      else delete from public.follows where follower_id=v_user_id and following_id=v_target_id; end if;
      select f.status into v_status from public.follows f where f.follower_id=v_user_id and f.following_id=v_target_id limit 1;
      return jsonb_build_object('state',jsonb_build_object('following',coalesce(v_status='accepted',false),'requested',coalesce(v_status='pending',false),'status',v_status));
    else raise exception using errcode='0A000',message='Capability not implemented: '||p_capability;
  end case;
end;
$$;
revoke all on function public.capability_dispatch(text,jsonb) from public;
grant execute on function public.capability_dispatch(text,jsonb) to anon,authenticated;