-- Canonical Posts transaction v1.
alter table public.polls add column if not exists question text;
drop policy if exists polls_owner_insert on public.polls;
create policy polls_owner_insert on public.polls for insert to authenticated with check (exists(select 1 from public.posts p where p.id=polls.post_id and p.author_id=auth.uid()));
drop policy if exists poll_options_owner_insert on public.poll_options;
create policy poll_options_owner_insert on public.poll_options for insert to authenticated with check (exists(select 1 from public.polls pl join public.posts p on p.id=pl.post_id where pl.id=poll_options.poll_id and p.author_id=auth.uid()));
drop policy if exists post_hashtags_owner_insert on public.post_hashtags;
create policy post_hashtags_owner_insert on public.post_hashtags for insert to authenticated with check (exists(select 1 from public.posts p where p.id=post_hashtags.post_id and p.author_id=auth.uid()));

create or replace function public.create_domain_notification(p_recipient_id uuid,p_event_type text,p_actor_id uuid default null,p_entity_type text default null,p_entity_id text default null,p_payload jsonb default '{}'::jsonb,p_unique_key text default null)
returns public.notifications language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare r public.notifications; v_key text; v_post_id uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_actor_id is not null and p_actor_id<>auth.uid() then raise exception 'ACTOR_MUST_BE_CURRENT_USER'; end if;
 if p_recipient_id is null then raise exception 'RECIPIENT_REQUIRED'; end if;
 if p_event_type not in ('message.created','message.reply','message.reaction','message.mention','call.incoming','call.missed','follow.created','mention','reply','like','repost','wallet.deposit.completed','wallet.deposit.failed') then raise exception 'UNSUPPORTED_NOTIFICATION_EVENT'; end if;
 if p_entity_type='post' and p_entity_id is not null then v_post_id:=p_entity_id::uuid; end if;
 v_key:=coalesce(p_unique_key,p_event_type||':'||p_recipient_id::text||':'||coalesce(p_entity_id,'')||':'||md5(coalesce(p_payload::text,'')));
 insert into public.notifications(recipient_id,actor_id,kind,post_id,data,category,group_key,action_url,dedupe_key,created_at)
 values(p_recipient_id,p_actor_id,p_event_type,v_post_id,p_payload,case when p_event_type in ('mention','reply','like','repost','follow.created') then 'social' else 'communications' end,p_event_type,coalesce(p_payload->>'actionUrl','/notifications'),v_key,now())
 on conflict(dedupe_key) do update set data=excluded.data,post_id=excluded.post_id returning * into r;
 return r;
end;$function$;
revoke all on function public.create_domain_notification(uuid,text,uuid,text,text,jsonb,text) from public;
grant execute on function public.create_domain_notification(uuid,text,uuid,text,text,jsonb,text) to authenticated;

create or replace function public.create_post_atomic(p_input jsonb)
returns jsonb language plpgsql security invoker set search_path to 'public' as $function$
declare u uuid:=auth.uid(); post_id uuid; poll_id uuid; product_id uuid; mentioned_id uuid; hashtag_id uuid; tag text; username text; expires_at timestamptz; poll jsonb; option_value text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if nullif(trim(coalesce(p_input->>'content',p_input->>'body','')),'') is null and coalesce(jsonb_array_length(coalesce(p_input->'media_urls','[]'::jsonb)),0)=0 and nullif(p_input->>'image_url','') is null and nullif(p_input->>'video_url','') is null then raise exception 'POST_CONTENT_REQUIRED'; end if;
 insert into public.posts(author_id,user_id,body,content,media_url,media_type,media_urls,image_url,video_url,is_video,visibility,community_id,reply_to_post_id,quoted_post_id,quote_post_id,quote_of_post_id,media_count)
 values(u,u,coalesce(p_input->>'body',p_input->>'content',''),coalesce(p_input->>'content',p_input->>'body',''),nullif(p_input->>'media_url',''),nullif(p_input->>'media_type',''),coalesce(p_input->'media_urls','[]'::jsonb),nullif(p_input->>'image_url',''),nullif(p_input->>'video_url',''),coalesce((p_input->>'is_video')::boolean,false),coalesce(nullif(p_input->>'visibility',''),'public'),nullif(p_input->>'community_id','')::uuid,nullif(p_input->>'reply_to_post_id','')::uuid,nullif(p_input->>'quoted_post_id','')::uuid,nullif(p_input->>'quote_post_id','')::uuid,nullif(p_input->>'quote_of_post_id','')::uuid,coalesce((p_input->>'media_count')::int,jsonb_array_length(coalesce(p_input->'media_urls','[]'::jsonb)))) returning id into post_id;
 poll:=p_input->'poll';
 if jsonb_typeof(poll)='object' then
  expires_at:=case when nullif(poll->>'expires_at','') is not null then (poll->>'expires_at')::timestamptz when nullif(poll->>'duration_minutes','') is not null then now()+((poll->>'duration_minutes')::int*interval '1 minute') else null end;
  insert into public.polls(post_id,question,expires_at,multiple_choice) values(post_id,coalesce(nullif(trim(poll->>'question'),''),'Poll'),expires_at,coalesce((poll->>'multiple_choice')::boolean,false)) returning id into poll_id;
  for option_value in select value from jsonb_array_elements_text(coalesce(poll->'options','[]'::jsonb)) loop
   if nullif(trim(option_value),'') is not null then insert into public.poll_options(poll_id,label,sort_order) values(poll_id,trim(option_value),(select count(*)::smallint from public.poll_options where poll_id=poll_id)); end if;
  end loop;
 end if;
 for product_id in select value::uuid from jsonb_array_elements_text(coalesce(p_input->'product_ids','[]'::jsonb)) loop
  insert into public.post_products(post_id,product_id) values(post_id,product_id) on conflict do nothing;
 end loop;
 for tag in select distinct lower(m[1]) from regexp_matches(coalesce(p_input->>'content',''),'#([A-Za-z0-9_]{1,64})','g') as m loop
  insert into public.hashtags(tag,post_count,usage_count,last_used_at) values(tag,0,0,now()) on conflict(tag) do update set last_used_at=now() returning id into hashtag_id;
  insert into public.post_hashtags(post_id,hashtag_id) values(post_id,hashtag_id) on conflict do nothing;
  update public.hashtags set post_count=(select count(*) from public.post_hashtags where hashtag_id=hashtags.id),usage_count=(select count(*) from public.post_hashtags where hashtag_id=hashtags.id),last_used_at=now() where id=hashtag_id;
 end loop;
 for username in select distinct lower(m[1]) from regexp_matches(coalesce(p_input->>'content',''),'@([A-Za-z0-9_]{3,32})','g') as m loop
  select pr.id into mentioned_id from public.profiles pr where lower(pr.username)=username and pr.id<>u and pr.discoverable_by_username=true limit 1;
  if mentioned_id is not null then
   insert into public.mentions(post_id,mentioned_user_id,username) values(post_id,mentioned_id,username) on conflict do nothing;
   perform public.create_domain_notification(mentioned_id,'mention',u,'post',post_id::text,jsonb_build_object('post_id',post_id,'actor_id',u,'username',username,'actionUrl','/post/'||post_id::text),'mention:'||mentioned_id::text||':'||post_id::text);
  end if;
 end loop;
 return jsonb_build_object('post_id',post_id,'poll_id',poll_id,'created',true);
end;$function$;
revoke all on function public.create_post_atomic(jsonb) from public;
grant execute on function public.create_post_atomic(jsonb) to authenticated;

do $body$ declare src text; old text; new text; begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' limit 1;
 if src is null then raise exception 'CAPABILITY_DISPATCH_NOT_FOUND'; end if;
 old:=$old$ when 'testagram.posts.create' then
   insert into public.posts(author_id,user_id,body,content,media_url,media_type,media_urls,image_url,video_url,is_video,visibility,community_id,reply_to_post_id,quoted_post_id,quote_post_id)
   values(u,u,coalesce(p_input->>'body',''),coalesce(p_input->>'content',p_input->>'body',''),p_input->>'media_url',p_input->>'media_type',
          coalesce(p_input->'media_urls','[]'::jsonb),p_input->>'image_url',p_input->>'video_url',coalesce((p_input->>'is_video')::boolean,false),
          coalesce(nullif(p_input->>'visibility',''),'public'),nullif(p_input->>'community_id','')::uuid,
          nullif(p_input->>'reply_to_post_id','')::uuid,nullif(p_input->>'quoted_post_id','')::uuid,nullif(p_input->>'quote_post_id','')::uuid)
   returning id into v_id;
   return jsonb_build_object('post_id',v_id);
$old$;
 new:=$new$ when 'testagram.posts.create' then
   return public.create_post_atomic(p_input);
$new$;
 if position(old in src)=0 then raise exception 'POSTS_CREATE_DISPATCH_BRANCH_NOT_FOUND'; end if;
 execute replace(src,old,new);
end $body$;
insert into public.capability_registry(name,version,access,readonly,description,enabled) values('testagram.posts.create',1,'authenticated',false,'Create a native Testagram post and its owned derivatives atomically.',true) on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=true,updated_at=now();
