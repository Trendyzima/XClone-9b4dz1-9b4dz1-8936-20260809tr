-- Notification capability preference contract v4.
-- Stores per-notification-type channel preferences in notification_preferences.preferences
-- while keeping push_enabled/email_enabled as derived compatibility projections.

CREATE OR REPLACE FUNCTION public.capability_dispatch_v2(p_capability text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid:=auth.uid();
  v_limit integer:=least(100,greatest(1,coalesce((p_input->>'limit')::integer,20)));
  v_unread_only boolean:=coalesce((p_input->>'unread_only')::boolean,false);
  v_id uuid;
  v jsonb;
  v_type text;
  v_current jsonb;
  v_merged jsonb;
begin
  p_capability:=btrim(coalesce(p_capability,''));
  if p_capability not in ('testagram.capabilities.list','testagram.health.read') and v_user_id is null then
    raise exception using errcode='28000',message='Authentication required';
  end if;

  if p_capability='testagram.posts.list' then
    return public.testagram_feed_v1(lower(coalesce(p_input->>'feed','following')),nullif(p_input->>'target_id','')::uuid,v_limit,nullif(p_input->>'cursor',''));
  end if;
  if p_capability='testagram.profile.timeline' then
    return public.testagram_feed_v1('profile',nullif(p_input->>'user_id','')::uuid,v_limit,nullif(p_input->>'cursor',''));
  end if;

  case p_capability
    when 'testagram.notifications.list' then
      return jsonb_build_object(
        'items',coalesce((
          select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc)
          from (
            select n.id,n.recipient_id,n.actor_id,n.kind,n.post_id,n.read_at,n.created_at,n.data,
                   null::text as priority,null::text as category,n.data->>'group_key' as group_key,
                   n.data->>'action_url' as action_url,null::timestamptz as expires_at,
                   null::timestamptz as archived_at,n.data->>'dedupe_key' as dedupe_key,
                   case when p.id is null then null else jsonb_build_object(
                     'id',p.id,'username',p.username,'display_name',p.display_name,
                     'avatar_url',p.avatar_url,'verified',p.verified
                   ) end as actor
            from public.notifications n
            left join public.profiles p on p.id=n.actor_id
            where coalesce(n.recipient_id,n.user_id,n.from_user_id)=v_user_id
              and (not v_unread_only or coalesce(n.read_at,case when coalesce(n.read,false) then now() else null end) is null)
              and coalesce((select (np.preferences->(n.kind)->>'in_app')::boolean
                            from public.notification_preferences np where np.user_id=v_user_id),true)
            order by n.created_at desc,n.id desc
            limit v_limit
          ) x
        ),'[]'::jsonb),
        'next_cursor',null
      );

    when 'testagram.notifications.unread_count' then
      return jsonb_build_object('count',(
        select count(*) from public.notifications n
        where coalesce(n.recipient_id,n.user_id,n.from_user_id)=v_user_id
          and coalesce(n.read_at,case when coalesce(n.read,false) then now() else null end) is null
          and coalesce((select (np.preferences->(n.kind)->>'in_app')::boolean
                        from public.notification_preferences np where np.user_id=v_user_id),true)
      ));

    when 'testagram.notifications.preferences' then
      select np.preferences into v_current from public.notification_preferences np where np.user_id=v_user_id;
      return jsonb_build_object('items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',v_user_id::text||':'||x.key,'user_id',v_user_id,'notif_type',x.key,
          'in_app',coalesce((x.value->>'in_app')::boolean,true),
          'push',coalesce((x.value->>'push')::boolean,false),
          'email',coalesce((x.value->>'email')::boolean,false),
          'sound_enabled',coalesce((x.value->>'sound_enabled')::boolean,true),
          'vibration_enabled',coalesce((x.value->>'vibration_enabled')::boolean,true),
          'digest_frequency',coalesce(x.value->>'digest_frequency','instant'),
          'quiet_hours_start',x.value->>'quiet_hours_start',
          'quiet_hours_end',x.value->>'quiet_hours_end',
          'timezone',coalesce(x.value->>'timezone','Africa/Nairobi'),
          'muted_until',x.value->>'muted_until','updated_at',now()
        ) order by x.key) from jsonb_each(coalesce(v_current,'{}'::jsonb)) x
      ),'[]'::jsonb));

    when 'testagram.notifications.preference_upsert' then
      v_type:=nullif(trim(p_input->>'notif_type'),'');
      if v_type is null then raise exception using errcode='22023',message='notif_type is required'; end if;
      v_current:=coalesce((select np.preferences from public.notification_preferences np where np.user_id=v_user_id),'{}'::jsonb);
      v_merged:=v_current || jsonb_build_object(v_type,jsonb_build_object(
        'in_app',coalesce((p_input->>'in_app')::boolean,true),
        'push',coalesce((p_input->>'push')::boolean,false),
        'email',coalesce((p_input->>'email')::boolean,false),
        'sound_enabled',coalesce((p_input->>'sound_enabled')::boolean,true),
        'vibration_enabled',coalesce((p_input->>'vibration_enabled')::boolean,true),
        'digest_frequency',coalesce(nullif(p_input->>'digest_frequency',''),'instant'),
        'quiet_hours_start',p_input->>'quiet_hours_start',
        'quiet_hours_end',p_input->>'quiet_hours_end',
        'timezone',coalesce(nullif(p_input->>'timezone',''),'Africa/Nairobi'),
        'muted_until',p_input->>'muted_until'
      ));
      insert into public.notification_preferences(user_id,preferences,push_enabled,email_enabled,updated_at)
      values(
        v_user_id,v_merged,
        exists(select 1 from jsonb_each(v_merged) e where coalesce((e.value->>'push')::boolean,false)),
        exists(select 1 from jsonb_each(v_merged) e where coalesce((e.value->>'email')::boolean,false)),
        now()
      )
      on conflict(user_id) do update set
        preferences=excluded.preferences,push_enabled=excluded.push_enabled,email_enabled=excluded.email_enabled,updated_at=now();
      return jsonb_build_object('preference',jsonb_build_object(
        'user_id',v_user_id,'notif_type',v_type,
        'in_app',coalesce((p_input->>'in_app')::boolean,true),
        'push',coalesce((p_input->>'push')::boolean,false),
        'email',coalesce((p_input->>'email')::boolean,false)
      ));

    when 'testagram.notifications.push.config' then
      select jsonb_build_object('public_key',c.vapid_public_key,'subject',c.vapid_subject) into v from public.notification_push_config c where c.id=true;
      if v is null then raise exception using errcode='P0001',message='PUSH_NOT_CONFIGURED'; end if;
      return v;

    when 'testagram.notifications.subscribe' then
      if nullif(trim(p_input->>'endpoint'),'') is null or nullif(trim(p_input->>'p256dh'),'') is null or nullif(trim(p_input->>'auth_key'),'') is null then
        raise exception using errcode='22023',message='PUSH_SUBSCRIPTION_INVALID';
      end if;
      insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key,platform,last_seen_at)
      values(v_user_id,p_input->>'endpoint',p_input->>'p256dh',p_input->>'auth_key',left(p_input->>'platform',120),now())
      on conflict(user_id,endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,platform=excluded.platform,last_seen_at=now();
      return jsonb_build_object('subscribed',true);

    when 'testagram.notifications.unsubscribe' then
      delete from public.push_subscriptions where user_id=v_user_id and endpoint=p_input->>'endpoint';
      return jsonb_build_object('unsubscribed',true);

    when 'testagram.notifications.test_push' then
      v_id:=public.create_domain_notification(v_user_id,'test_push',null,null,'test_push',jsonb_build_object('title','Testagram notifications','body','Push notifications are working on this device.','action_url','/notifications'),'test_push:'||v_user_id::text||':'||to_char(date_trunc('minute',now()),'YYYYMMDDHH24MI'));
      return jsonb_build_object('notification_id',v_id,'queued',v_id is not null);

    when 'testagram.notifications.realtime_contract' then
      return jsonb_build_object('schema','public','table','notifications','event','INSERT','filter','recipient_id=eq.'||v_user_id::text,'authenticated',true);

    else
      return public.capability_dispatch_legacy(p_capability,p_input);
  end case;
end;
$function$

