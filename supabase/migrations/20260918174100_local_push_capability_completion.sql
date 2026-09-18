insert into public.capability_registry(name,version,access,readonly,description,enabled)
values
('testagram.notifications.push.config',1,'authenticated',true,'Return the public Web Push application server key.',true),
('testagram.notifications.unsubscribe',1,'authenticated',false,'Remove the current user device push subscription.',true),
('testagram.notifications.test_push',1,'authenticated',false,'Queue a device-local push notification for the current user.',true),
('testagram.notifications.realtime_contract',1,'authenticated',true,'Return the authenticated notifications realtime contract.',true)
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=true;

create or replace function public.capability_dispatch(p_capability text, p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path to 'public'
as $function$
declare
 u uuid:=auth.uid(); v jsonb; v_id uuid; v_limit int:=greatest(1,least(coalesce((p_input->>'limit')::int,20),50));
 v_cursor text:=nullif(p_input->>'cursor',''); v_ts timestamptz; v_uuid uuid;
begin
 if u is null and p_capability not in ('testagram.capabilities.list','testagram.health.read','testagram.search.users','testagram.search.posts','testagram.search.hashtags','testagram.search.communities','testagram.trends.list','testagram.profile.timeline') then raise exception 'AUTH_REQUIRED'; end if;
 if v_cursor is not null then begin if position('|' in v_cursor)=0 then raise exception 'INVALID_CURSOR'; end if; v_ts:=split_part(v_cursor,'|',1)::timestamptz; v_uuid:=split_part(v_cursor,'|',2)::uuid; exception when others then raise exception 'INVALID_CURSOR'; end; end if;
 case p_capability
 when 'testagram.capabilities.list' then select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into v from (select name,version,access,readonly,description from public.capability_registry where enabled) x; return v;
 when 'testagram.health.read' then return jsonb_build_object('status','ok','service','testagram-capability-plane');
 when 'testagram.posts.create' then return public.create_post_atomic(p_input);
 when 'testagram.posts.schedule' then return public.schedule_post_atomic(p_input);
 when 'testagram.notifications.push.config' then
   select jsonb_build_object('public_key',vapid_public_key,'subject',vapid_subject) into v from public.notification_push_config where id=true;
   if v is null then raise exception 'PUSH_NOT_CONFIGURED'; end if; return v;
 when 'testagram.notifications.subscribe' then
   if nullif(trim(p_input->>'endpoint'),'') is null then raise exception 'PUSH_ENDPOINT_REQUIRED'; end if;
   insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key,platform,last_seen_at) values(u,p_input->>'endpoint',p_input->>'p256dh',p_input->>'auth_key',p_input->>'platform',now())
   on conflict (user_id,endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,platform=excluded.platform,last_seen_at=now();
   return jsonb_build_object('subscribed',true);
 when 'testagram.notifications.unsubscribe' then delete from public.push_subscriptions where user_id=u and endpoint=p_input->>'endpoint'; return jsonb_build_object('unsubscribed',true);
 when 'testagram.notifications.test_push' then
   select id into v_id from public.create_domain_notification(u,'like',null,null,null,jsonb_build_object('actionUrl','/notifications','test',true,'message','Testagram push notifications are working on this device.'),'push-test:'||u::text||':'||to_char(date_trunc('second',now()),'YYYYMMDDHH24MISSMS'));
   return jsonb_build_object('notification_id',v_id,'queued',true);
 when 'testagram.notifications.realtime_contract' then return jsonb_build_object('schema','public','table','notifications','event','INSERT','filter','recipient_id=eq.'||u::text,'authenticated',true);
 when 'testagram.messages.reply' then
   v_id:=(p_input->>'message_id')::uuid;
   if not exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=u where m.id=v_id) then raise exception 'MESSAGE_NOT_FOUND'; end if;
   insert into public.messages(conversation_id,sender_id,body,reply_to_message_id,shared_post_id,client_message_id)
   select m.conversation_id,u,coalesce(p_input->>'body',''),v_id,nullif(p_input->>'shared_post_id','')::uuid,nullif(p_input->>'client_message_id','') from public.messages m where m.id=v_id returning id into v_id;
   return jsonb_build_object('message_id',v_id);
 when 'testagram.messages.attach' then
   v_id:=(p_input->>'message_id')::uuid;
   if not exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=u where m.id=v_id and m.sender_id=u) then raise exception 'MESSAGE_NOT_FOUND'; end if;
   insert into public.message_attachments(message_id,owner_id,media_url,media_type,mime_type,byte_size,duration_ms,width,height)
   values(v_id,u,coalesce(p_input->>'media_url',''),coalesce(p_input->>'media_type','file'),p_input->>'mime_type',coalesce((p_input->>'byte_size')::bigint,0),nullif(p_input->>'duration_ms','')::bigint,nullif(p_input->>'width','')::int,nullif(p_input->>'height','')::int) returning id into v_id;
   return jsonb_build_object('attachment_id',v_id);
 when 'testagram.messages.typing' then return jsonb_build_object('user_id',u,'conversation_id',(p_input->>'conversation_id')::uuid,'typing',coalesce((p_input->>'typing')::boolean,true));
 when 'testagram.follow_requests.list' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v from (select fr.requester_id,fr.target_id,fr.status,fr.created_at,jsonb_build_object('id',pr.id,'username',pr.username,'display_name',pr.display_name,'avatar_url',pr.avatar_url) requester from public.follow_requests fr join public.profiles pr on pr.id=fr.requester_id where fr.target_id=u and fr.status='pending' order by fr.created_at desc limit v_limit) x;
   return jsonb_build_object('items',coalesce(v,'[]'::jsonb),'next_cursor',null);
 when 'testagram.follow_requests.respond' then
   v_id:=(p_input->>'requester_id')::uuid;
   if p_input->>'action' not in ('accept','reject') then raise exception 'INVALID_FOLLOW_REQUEST_ACTION'; end if;
   if not exists(select 1 from public.follow_requests fr where fr.requester_id=v_id and fr.target_id=u and fr.status='pending') then raise exception 'FOLLOW_REQUEST_NOT_FOUND'; end if;
   if p_input->>'action'='accept' then update public.follow_requests set status='accepted' where requester_id=v_id and target_id=u and status='pending'; insert into public.follows(follower_id,following_id,status,accepted_at) values(v_id,u,'accepted',now()) on conflict(follower_id,following_id) do update set status='accepted',accepted_at=now(); else update public.follow_requests set status='rejected' where requester_id=v_id and target_id=u and status='pending'; delete from public.follows where follower_id=v_id and following_id=u; end if;
   return jsonb_build_object('requester_id',v_id,'target_id',u,'action',p_input->>'action','status',case when p_input->>'action'='accept' then 'accepted' else 'rejected' end);
 else return public.capability_dispatch_core(p_capability,p_input);
 end case;
end $function$;

select cron.unschedule(jobid) from cron.job where jobname='testagram-notification-push-worker';
select cron.schedule('testagram-notification-push-worker','15 seconds',$job$select net.http_post(url := 'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/push-notification-delivery',headers := jsonb_build_object('Content-Type','application/json','x-notification-worker-token',(select worker_token from public.notification_push_config where id=true),'x-batch-size','20'),body := jsonb_build_object('source','pg_cron-notification-push','time',now()),timeout_milliseconds := 10000);$job$);