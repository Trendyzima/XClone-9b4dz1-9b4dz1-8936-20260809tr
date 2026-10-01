-- Persist the poll-aware post creation path in source control.
-- The capability gateway delegates testagram.posts.create to this function.
CREATE OR REPLACE FUNCTION public.capability_dispatch_legacy(p_capability text, p_input jsonb DEFAULT '{}'::jsonb)
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

    when 'testagram.wallet.read' then
      return jsonb_build_object('wallet', (select to_jsonb(w) from public.wallets w where w.user_id=v_user_id::text limit 1),'transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc) from (select id,wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,provider_order_id,provider_reference,provider_status,provider_capture_id,description,metadata,payment_method,reference,completed_at,created_at,updated_at,transfer_id,counterparty_user_id from public.wallet_transactions where user_id=v_user_id::text order by created_at desc,id desc limit v_limit) t),'[]'::jsonb),'next_cursor',null);
    when 'testagram.notifications.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc)
        from public.notifications n
        where coalesce(n.recipient_id,n.user_id,n.from_user_id)=v_user_id
          and coalesce(n.read_at,case when coalesce(n.read,false) then now() else null end) is null
        limit v_limit),'[]'::jsonb),'next_cursor',null);

    when 'testagram.notifications.unread_count' then
      return jsonb_build_object('count',(select count(*) from public.notifications n where coalesce(n.recipient_id,n.user_id)=v_user_id and coalesce(n.read_at,case when coalesce(n.read,false) then now() else null end) is null));

    when 'testagram.notifications.mark_read' then
      update public.notifications set read_at=coalesce(read_at,now()),read=true
      where id=(p_input->>'notification_id')::uuid and coalesce(recipient_id,user_id)=v_user_id;
      return jsonb_build_object('notification_id',(p_input->>'notification_id')::uuid,'read',true);

    when 'testagram.notifications.mark_all_read' then
      update public.notifications set read_at=now(),read=true where coalesce(recipient_id,user_id)=v_user_id and read_at is null;
      get diagnostics v_limit=row_count;
      return jsonb_build_object('updated',v_limit);

    when 'testagram.notifications.dismiss' then
      update public.notifications set read_at=coalesce(read_at,now()),read=true
      where id=(p_input->>'notification_id')::uuid and coalesce(recipient_id,user_id)=v_user_id;
      return jsonb_build_object('notification_id',(p_input->>'notification_id')::uuid,'dismissed',true);

    when 'testagram.notifications.preferences' then
      return jsonb_build_object('preference',coalesce((select to_jsonb(np) from public.notification_preferences np where np.user_id=v_user_id),'{}'::jsonb));

    when 'testagram.notifications.preference_upsert' then
      insert into public.notification_preferences(user_id,preferences,push_enabled,email_enabled,updated_at)
      values(v_user_id,coalesce(p_input->'preferences','{}'::jsonb),coalesce((p_input->>'push_enabled')::boolean,false),coalesce((p_input->>'email_enabled')::boolean,false),now())
      on conflict(user_id) do update set preferences=excluded.preferences,push_enabled=excluded.push_enabled,email_enabled=excluded.email_enabled,updated_at=now();
      return jsonb_build_object('saved',true);

    when 'testagram.notifications.realtime_contract' then
      return jsonb_build_object('schema','public','table','notifications','event','INSERT','filter','recipient_id=eq.'||v_user_id::text,'authenticated',true);

    when 'testagram.notifications.rank' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc)
        from public.notifications n where coalesce(n.recipient_id,n.user_id)=v_user_id and n.read_at is null limit v_limit),'[]'::jsonb),'next_cursor',null);

    when 'testagram.messages.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc,m.id desc)
        from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=v_user_id and cm.left_at is null
        where m.deleted_at is null and (p_input->>'conversation_id' is null or m.conversation_id=(p_input->>'conversation_id')::uuid)
        limit v_limit),'[]'::jsonb),'next_cursor',null);

    when 'testagram.messages.send_encrypted' then
      if not exists(select 1 from public.conversation_members cm where cm.conversation_id=(p_input->>'conversation_id')::uuid and cm.user_id=v_user_id and cm.left_at is null) then
        raise exception using errcode='42501',message='Conversation membership required';
      end if;
      insert into public.messages(conversation_id,sender_id,client_message_id,ciphertext,nonce,key_epoch,message_type,reply_to_id,attachment_metadata)
      values((p_input->>'conversation_id')::uuid,v_user_id,nullif(p_input->>'client_message_id',''),p_input->>'ciphertext',p_input->>'nonce',
             coalesce((p_input->>'key_epoch')::bigint,0),coalesce(nullif(p_input->>'message_type',''),'text'),
             nullif(p_input->>'reply_to_id','')::uuid,coalesce(p_input->'attachment_metadata','{}'::jsonb))
      returning id into v_reply_id;
      return jsonb_build_object('message_id',v_reply_id,'created',true);

    when 'testagram.messages.edit_encrypted' then
      update public.messages set ciphertext=p_input->>'ciphertext',nonce=p_input->>'nonce',edited_at=now(),updated_at=now()
      where id=(p_input->>'message_id')::uuid and sender_id=v_user_id and deleted_at is null;
      return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'edited',true);

    when 'testagram.messages.delete' then
      update public.messages set deleted_at=now(),updated_at=now()
      where id=(p_input->>'message_id')::uuid and sender_id=v_user_id and deleted_at is null;
      return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'deleted',true);

    when 'testagram.messages.mark_read' then
      update public.conversation_members set last_read_at=now()
      where conversation_id=(p_input->>'conversation_id')::uuid and user_id=v_user_id;
      return jsonb_build_object('conversation_id',(p_input->>'conversation_id')::uuid,'read',true);

    when 'testagram.messages.attach' then
      update public.messages set attachment_metadata=coalesce(attachment_metadata,'{}'::jsonb)||coalesce(p_input->'attachment_metadata','{}'::jsonb),updated_at=now()
      where id=(p_input->>'message_id')::uuid and sender_id=v_user_id and deleted_at is null;
      return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'attached',true);

    when 'testagram.messages.react' then
      insert into public.message_reactions(message_id,user_id,emoji)
      values((p_input->>'message_id')::uuid,v_user_id,coalesce(nullif(p_input->>'emoji',''),'❤️'))
      on conflict(message_id,user_id) do update set emoji=excluded.emoji;
      return jsonb_build_object('message_id',(p_input->>'message_id')::uuid,'emoji',coalesce(nullif(p_input->>'emoji',''),'❤️'));

    when 'testagram.conversations.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at desc)
        from public.conversations c join public.conversation_members cm on cm.conversation_id=c.id
        where cm.user_id=v_user_id and cm.left_at is null limit v_limit),'[]'::jsonb),'next_cursor',null);

    when 'testagram.conversations.create' then
      insert into public.conversations(created_by,kind,title,encrypted)
      values(v_user_id,coalesce(nullif(p_input->>'kind',''),'direct'),nullif(p_input->>'title',''),coalesce((p_input->>'encrypted')::boolean,true))
      returning id into v_reply_id;
      insert into public.conversation_members(conversation_id,user_id,role) values(v_reply_id,v_user_id,'owner');
      if jsonb_typeof(p_input->'member_ids')='array' then
        insert into public.conversation_members(conversation_id,user_id,role)
        select v_reply_id,x::uuid,'member' from jsonb_array_elements_text(p_input->'member_ids') x
        where x::uuid<>v_user_id on conflict do nothing;
      end if;
      return jsonb_build_object('conversation',to_jsonb((select c from public.conversations c where c.id=v_reply_id)));

    when 'testagram.communication.devices.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(d)) from public.communication_devices d where d.user_id=v_user_id),'[]'::jsonb));

    when 'testagram.communication.keys.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(k)) from public.communication_keys k where k.user_id=v_user_id),'[]'::jsonb));

    when 'testagram.communication.keys.put' then
      insert into public.communication_keys(user_id,device_id,key_type,public_key,metadata)
      values(v_user_id,p_input->>'device_id',p_input->>'key_type',p_input->>'public_key',coalesce(p_input->'metadata','{}'::jsonb))
      on conflict(user_id,device_id,key_type) do update set public_key=excluded.public_key,metadata=excluded.metadata,updated_at=now();
      return jsonb_build_object('saved',true);    when 'testagram.posts.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
        select p.id as post_id,p.id,p.user_id,p.author_id,p.content,p.image_url,p.video_url,p.is_video,p.media_urls,p.media_count,p.likes_count,p.reposts_count,p.replies_count,p.views_count,p.community_id,p.quoted_post_id,p.created_at,
               jsonb_build_object('id',pr.id,'username',pr.username,'display_name',pr.display_name,'avatar_url',pr.avatar_url,'verified',pr.verified) profile
        from public.posts p join public.profiles pr on pr.id=coalesce(p.author_id,p.user_id)
        where p.deleted_at is null order by p.created_at desc,p.id desc limit v_limit) x),'[]'::jsonb),'next_cursor',null);

    when 'testagram.posts.create' then
      if nullif(v_content,'') is null and jsonb_typeof(p_input->'poll') <> 'object' then
        raise exception using errcode='22023',message='Post content is required';
      end if;

      insert into public.posts(user_id,author_id,content,community_id,image_url,video_url,is_video,media_urls,media_count,quoted_post_id)
      values(
        v_user_id,
        v_user_id,
        coalesce(nullif(v_content,''),nullif(p_input->'poll'->>'question','')),
        nullif(p_input->>'community_id','')::uuid,
        nullif(p_input->>'image_url',''),
        nullif(p_input->>'video_url',''),
        coalesce((p_input->>'is_video')::boolean,false),
        case when jsonb_typeof(p_input->'media_urls')='array' then array(select jsonb_array_elements_text(p_input->'media_urls')) else '{}'::text[] end,
        coalesce((p_input->>'media_count')::integer,0),
        nullif(coalesce(p_input->>'quoted_post_id',p_input->>'quote_post_id'),'')::uuid
      )
      returning id into v_post_id;

      if jsonb_typeof(p_input->'poll') = 'object' then
        declare
          v_poll_id uuid;
          v_poll_question text;
          v_poll_options text[];
          v_poll_duration integer;
          v_poll_ends_at timestamptz;
          v_poll_count integer;
        begin
          v_poll_question := nullif(trim(p_input->'poll'->>'question'),'');
          select coalesce(
            array_agg(trim(value) order by ordinality) filter (where char_length(trim(value)) > 0),
            '{}'::text[]
          )
          into v_poll_options
          from jsonb_array_elements_text(coalesce(p_input->'poll'->'options','[]'::jsonb)) with ordinality;

          v_poll_count := coalesce(array_length(v_poll_options,1),0);

          if v_poll_question is null or char_length(v_poll_question) < 5 then
            raise exception using errcode='22023',message='Poll question is too short';
          end if;
          if v_poll_count < 2 or v_poll_count > 8 then
            raise exception using errcode='22023',message='A poll needs 2 to 8 answers';
          end if;

          v_poll_duration := greatest(
            1,
            least(coalesce((p_input->'poll'->>'duration_minutes')::integer,1440),10080)
          );
          v_poll_ends_at := now() + make_interval(mins => v_poll_duration);

          insert into public.polls(
            post_id,creator_id,question,description,allow_multiple,visibility,ends_at
          )
          values(
            v_post_id,v_user_id,v_poll_question,null,false,'public',v_poll_ends_at
          )
          returning id into v_poll_id;

          insert into public.poll_options(poll_id,label,position)
          select v_poll_id,trim(value),(ordinality::integer-1)::smallint
          from unnest(v_poll_options) with ordinality as x(value, ordinality);

          return jsonb_build_object(
            'post_id',v_post_id,
            'poll_id',v_poll_id,
            'created',true
          );
        end;
      end if;

      return jsonb_build_object('post_id',v_post_id,'poll_id',null,'created',true);

    when 'testagram.posts.quote' then
      v_post_id:=(p_input->>'post_id')::uuid;
      if not exists(select 1 from public.posts where id=v_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Post not found'; end if;
      if nullif(v_content,'') is null then raise exception using errcode='22023',message='Quote content is required'; end if;
      insert into public.posts(user_id,author_id,content,quoted_post_id) values(v_user_id,v_user_id,v_content,v_post_id) returning id into v_reply_id;
      return jsonb_build_object('post_id',v_reply_id,'created',true);

    when 'testagram.search.posts' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
        select p.id as post_id,p.content,p.image_url,p.video_url,p.media_urls,p.media_count,p.likes_count,p.reposts_count,p.replies_count,p.created_at,
        jsonb_build_object('id',pr.id,'username',pr.username,'display_name',pr.display_name,'avatar_url',pr.avatar_url,'verified',pr.verified) profile
        from public.posts p join public.profiles pr on pr.id=coalesce(p.author_id,p.user_id)
        where p.deleted_at is null and (v_q='' or p.content ilike '%'||v_q||'%')
        order by p.created_at desc,p.id desc limit v_limit) x),'[]'::jsonb),'next_cursor',null);

    when 'testagram.profile.timeline' then
      v_target_id:=(p_input->>'user_id')::uuid;
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
        select p.id as post_id,p.content,p.image_url,p.video_url,p.media_urls,p.media_count,p.likes_count,p.reposts_count,p.replies_count,p.views_count,p.created_at
        from public.posts p where coalesce(p.author_id,p.user_id)=v_target_id and p.deleted_at is null
        order by p.created_at desc,p.id desc limit v_limit) x),'[]'::jsonb),'next_cursor',null);

    when 'testagram.search.communities' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(c) order by lower(c.name),c.id) from (
        select id,name,slug,display_name,description,avatar_url,cover_url,visibility,member_count,post_count,is_private,created_at from public.communities
        where v_q='' or name ilike '%'||v_q||'%' or display_name ilike '%'||v_q||'%' order by lower(name),id limit v_limit) c),'[]'::jsonb),'next_cursor',null);

    when 'testagram.communities.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(c) order by c.member_count desc,c.created_at desc) from (
        select id,name,slug,display_name,description,avatar_url,cover_url,visibility,member_count,post_count,is_private,created_at from public.communities c
        where c.is_private=false or exists(select 1 from public.community_members m where m.community_id=c.id and m.user_id=v_user_id)
        order by member_count desc,created_at desc limit v_limit) c),'[]'::jsonb));

    when 'testagram.communities.create' then
      return jsonb_build_object('community',to_jsonb(public.create_community(coalesce(nullif(p_input->>'name',''),'community-'||substr(gen_random_uuid()::text,1,8)),nullif(p_input->>'display_name',''),nullif(p_input->>'description',''),coalesce((p_input->>'is_private')::boolean,false),coalesce(p_input->'rules','{}'::jsonb))));

    when 'testagram.communities.join' then
      return jsonb_build_object('membership',to_jsonb(public.join_community((p_input->>'community_id')::uuid)));

    when 'testagram.communities.leave' then
      return jsonb_build_object('membership',jsonb_build_object('left',public.leave_community((p_input->>'community_id')::uuid)));

    when 'testagram.bookmarks.list' then return public.testagram_bookmarks_list(v_limit,0);
    when 'testagram.bookmarks.add' then return jsonb_build_object('bookmark',public.testagram_bookmark_add((p_input->>'post_id')::uuid));
    when 'testagram.bookmarks.remove' then return jsonb_build_object('removed',public.testagram_bookmark_remove((p_input->>'post_id')::uuid));
    when 'testagram.bookmarks.toggle' then return public.testagram_bookmark_toggle((p_input->>'post_id')::uuid);

    when 'testagram.recommendations.generate' then
      perform public.generate_content_recommendations(v_user_id);
      return jsonb_build_object('recommendations',coalesce((select jsonb_agg(to_jsonb(r) order by r.score desc,r.created_at desc) from public.content_recommendations r where r.user_id=v_user_id limit v_limit),'[]'::jsonb));

    when 'testagram.daily_rewards.claim' then return public.claim_daily_reward();
    when 'testagram.referrals.code' then return jsonb_build_object('code',public.ensure_referral_code());
    when 'testagram.referrals.apply' then return public.apply_referral_code(p_input->>'code');
    when 'testagram.referrals.complete' then return public.complete_referral();
    when 'testagram.referrals.status' then return public.get_referral_status();
    when 'testagram.referrals.read' then return public.list_referrals();
    when 'testagram.referrals.leaderboard' then return public.referral_leaderboard();

    when 'testagram.stories.active' then return public.testagram_active_stories((p_input->>'owner_id')::uuid);
    when 'testagram.stories.publish' then return public.testagram_story_publish(coalesce(p_input->'media','[]'::jsonb),p_input->>'caption',coalesce(nullif(p_input->>'visibility',''),'public'));
    when 'testagram.stories.expire' then return jsonb_build_object('expired',public.testagram_expire_stories());    when 'testagram.posts.reaction.set' then
      v_post_id:=(p_input->>'post_id')::uuid; v_emoji:=coalesce(nullif(p_input->>'emoji',''),'❤️');
      delete from public.post_reactions where post_id=v_post_id and user_id=v_user_id;
      insert into public.post_reactions(post_id,user_id,emoji) values(v_post_id,v_user_id,v_emoji);
      return jsonb_build_object('reaction',jsonb_build_object('post_id',v_post_id,'emoji',v_emoji));

    when 'testagram.posts.reaction.list' then
      v_post_id:=(p_input->>'post_id')::uuid;
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
        select id,post_id,user_id,emoji,created_at from public.post_reactions where post_id=v_post_id order by created_at desc limit v_limit) r),'[]'::jsonb),'next_cursor',null);

    when 'testagram.profile.update' then
      return public.profile_update(p_input);

    when 'testagram.inbox.list' then
      return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.platform_inbox i where i.user_id=v_user_id limit v_limit),'[]'::jsonb),'next_cursor',null);

    when 'testagram.inbox.mark_read' then
      update public.platform_inbox set read_at=coalesce(read_at,now()) where id=(p_input->>'id')::uuid and user_id=v_user_id;
      return jsonb_build_object('read',true);

    when 'testagram.inbox.generate_digest' then
      return public.generate_platform_inbox_digest();    else
      raise exception using errcode='0A000',message='Capability not implemented: '||p_capability;
  end case;
end;
$function$

