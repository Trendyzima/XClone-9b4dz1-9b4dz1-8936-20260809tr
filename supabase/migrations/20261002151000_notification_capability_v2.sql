create or replace function public.capability_dispatch_v2(p_capability text,p_input jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path=public as $function$
declare v_user_id uuid:=auth.uid(); v jsonb; v_id uuid;
begin p_capability:=btrim(coalesce(p_capability,'')); if p_capability not in ('testagram.capabilities.list','testagram.health.read') and v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
case p_capability
when 'testagram.posts.create' then return public.create_post_atomic_v3(p_input);
when 'testagram.notifications.push.config' then select jsonb_build_object('public_key',c.vapid_public_key,'subject',c.vapid_subject) into v from public.notification_push_config c where c.id=true; if v is null then raise exception using errcode='P0001',message='PUSH_NOT_CONFIGURED'; end if; return v;
when 'testagram.notifications.subscribe' then if nullif(trim(p_input->>'endpoint'),'') is null or nullif(trim(p_input->>'p256dh'),'') is null or nullif(trim(p_input->>'auth_key'),'') is null then raise exception using errcode='22023',message='PUSH_SUBSCRIPTION_INVALID'; end if; insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key,platform,last_seen_at) values(v_user_id,p_input->>'endpoint',p_input->>'p256dh',p_input->>'auth_key',left(p_input->>'platform',120),now()) on conflict(user_id,endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,platform=excluded.platform,last_seen_at=now(); return jsonb_build_object('subscribed',true);
when 'testagram.notifications.unsubscribe' then delete from public.push_subscriptions where user_id=v_user_id and endpoint=p_input->>'endpoint'; return jsonb_build_object('unsubscribed',true);
when 'testagram.notifications.test_push' then v_id:=public.create_domain_notification(v_user_id,'test_push',null,null,'test_push',jsonb_build_object('title','Testagram notifications','body','Push notifications are working on this device.','action_url','/notifications'),'test_push:'||v_user_id::text||':'||to_char(date_trunc('minute',now()),'YYYYMMDDHH24MI')); return jsonb_build_object('notification_id',v_id,'queued',v_id is not null);
when 'testagram.notifications.realtime_contract' then return jsonb_build_object('schema','public','table','notifications','event','INSERT','filter','recipient_id=eq.'||v_user_id::text,'authenticated',true);
else return public.capability_dispatch_legacy(p_capability,p_input);
end case; end; $function$;
revoke all on function public.capability_dispatch_v2(text,jsonb) from public;
grant execute on function public.capability_dispatch_v2(text,jsonb) to anon,authenticated;
