create or replace function public.testagram_create_local_reply_v2(
  p_post_id uuid,
  p_content text,
  p_parent_reply_id uuid default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare v_user uuid:=auth.uid(); v_content text:=btrim(coalesce(p_content,'')); v_id uuid; v_count bigint;
begin
  if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if v_content='' then raise exception using errcode='22023',message='Reply content is required'; end if;
  if length(v_content)>10000 then raise exception using errcode='22023',message='Reply is too long'; end if;
  if not exists(select 1 from public.posts where id=p_post_id and deleted_at is null) then raise exception using errcode='P0002',message='Post not found'; end if;
  if p_parent_reply_id is not null and not exists(select 1 from public.replies r where r.id=p_parent_reply_id and r.post_id=p_post_id) then raise exception using errcode='22023',message='Parent reply must belong to the same post'; end if;
  insert into public.replies(post_id,user_id,content,parent_reply_id) values(p_post_id,v_user,v_content,p_parent_reply_id) returning id into v_id;
  select count(*) into v_count from public.replies where post_id=p_post_id;
  update public.posts set replies_count=v_count,updated_at=now() where id=p_post_id;
  return jsonb_build_object('reply_id',v_id,'created',true,'replies_count',v_count,'parent_reply_id',p_parent_reply_id);
end
$function$;

create or replace function public.capability_dispatch(
  p_capability text,
  p_input jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare v_user_id uuid:=auth.uid(); v_limit int:=least(100,greatest(1,coalesce((p_input->>'limit')::int,20))); v_id uuid; v_post uuid; v_owner uuid; v_status text;
begin
 p_capability:=btrim(coalesce(p_capability,''));
 if p_capability not in ('testagram.capabilities.list','testagram.health.read') and v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
 case p_capability
   when 'testagram.lists.list' then return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id desc) from (select l.* from lists l where l.owner_id=v_user_id or not l.is_private or exists(select 1 from list_members lm where lm.list_id=l.id and lm.user_id=v_user_id) order by l.updated_at desc,l.id desc limit v_limit)x),'[]'::jsonb));
   when 'testagram.lists.create' then insert into lists(owner_id,name,description,is_private) values(v_user_id,nullif(btrim(p_input->>'name'),''),nullif(p_input->>'description',''),coalesce((p_input->>'is_private')::boolean,false)) returning id into v_id; return jsonb_build_object('list',to_jsonb((select l from lists l where l.id=v_id)));
   when 'testagram.lists.member.add' then v_id:=(p_input->>'list_id')::uuid; v_owner:=v_user_id; if not exists(select 1 from lists where id=v_id and owner_id=v_owner) then raise exception using errcode='42501',message='List ownership required'; end if; insert into list_members(list_id,user_id) values(v_id,(p_input->>'user_id')::uuid) on conflict do nothing; return jsonb_build_object('member',to_jsonb((select lm from list_members lm where lm.list_id=v_id and lm.user_id=(p_input->>'user_id')::uuid)));
   when 'testagram.lists.member.remove' then v_id:=(p_input->>'list_id')::uuid; if not exists(select 1 from lists where id=v_id and owner_id=v_user_id) then raise exception using errcode='42501',message='List ownership required'; end if; delete from list_members where list_id=v_id and user_id=(p_input->>'user_id')::uuid; return jsonb_build_object('removed',true);
   when 'testagram.lists.timeline' then v_id:=(p_input->>'list_id')::uuid; if not exists(select 1 from lists l where l.id=v_id and (l.owner_id=v_user_id or not l.is_private or exists(select 1 from list_members lm where lm.list_id=v_id and lm.user_id=v_user_id))) then raise exception using errcode='42501',message='List access denied'; end if; return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (select p.id as post_id,p.content,p.user_id,p.author_id,p.image_url,p.video_url,p.media_urls,p.media_count,p.likes_count,p.reposts_count,p.replies_count,p.views_count,p.created_at from posts p where p.deleted_at is null and coalesce(p.author_id,p.user_id) in (select lm.user_id from list_members lm where lm.list_id=v_id union select l.owner_id from lists l where l.id=v_id) order by p.created_at desc,p.id desc limit v_limit)x),'[]'::jsonb),'next_cursor',null);
   when 'testagram.media.list' then return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc,m.id desc) from media_assets m where m.owner_id=v_user_id order by m.created_at desc,m.id desc limit v_limit),'[]'::jsonb),'next_cursor',null);
   when 'testagram.media.attach' then v_post:=(p_input->>'post_id')::uuid; v_id:=(p_input->>'media_asset_id')::uuid; if not exists(select 1 from posts where id=v_post and coalesce(author_id,user_id)=v_user_id and deleted_at is null) then raise exception using errcode='42501',message='Post ownership required'; end if; if not exists(select 1 from media_assets where id=v_id and owner_id=v_user_id) then raise exception using errcode='42501',message='Media ownership required'; end if; update media_assets set post_id=v_post,updated_at=now() where id=v_id; insert into post_media(post_id,owner_id,media_url,media_type,mime_type,byte_size,media_asset_id,sort_order) select v_post,v_user_id,m.media_url,m.media_type,m.mime_type,m.byte_size,m.id,coalesce((p_input->>'sort_order')::smallint,0) from media_assets m where m.id=v_id on conflict do nothing; return jsonb_build_object('media',to_jsonb((select pm from post_media pm where pm.media_asset_id=v_id and pm.post_id=v_post limit 1)));
   when 'testagram.trends.list' then return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(t) order by t.posts_count desc,t.updated_at desc,t.id desc) from trending_topics t order by t.posts_count desc,t.updated_at desc,t.id desc limit v_limit),'[]'::jsonb));
   when 'testagram.follow_requests.list' then return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (select f.id,f.follower_id requester_id,f.following_id target_id,f.status,f.created_at,p.username,p.display_name,p.avatar_url from follows f join profiles p on p.id=f.follower_id where f.following_id=v_user_id and f.status='pending' order by f.created_at desc limit v_limit)x),'[]'::jsonb),'next_cursor',null);
   when 'testagram.follow_requests.respond' then v_id:=(p_input->>'requester_id')::uuid; v_status:=lower(p_input->>'action'); if v_status not in ('accept','reject') then raise exception using errcode='22023',message='Action must be accept or reject'; end if; if not exists(select 1 from follows where follower_id=v_id and following_id=v_user_id and status='pending') then raise exception using errcode='P0002',message='Follow request not found'; end if; if v_status='accept' then update follows set status='accepted',updated_at=now() where follower_id=v_id and following_id=v_user_id; else delete from follows where follower_id=v_id and following_id=v_user_id; end if; return jsonb_build_object('requester_id',v_id,'target_id',v_user_id,'action',v_status,'status',case when v_status='accept' then 'accepted' else 'rejected' end);
   when 'testagram.federation.status' then return jsonb_build_object('items',jsonb_build_array(jsonb_build_object('type','delivery','pending',(select count(*) from federation_deliveries where status in ('pending','retry','in_flight')),'delivered',(select count(*) from federation_deliveries where status='delivered'),'failed',(select count(*) from federation_deliveries where status in ('dead_letter','auth_failure','gone'))),jsonb_build_object('type','activities','queued',(select count(*) from federated_activities where processing_state='queued'),'processed',(select count(*) from federated_activities where processing_state='processed')),jsonb_build_object('type','actors','count',(select count(*) from federated_actors))), 'next_cursor',null);
   when 'testagram.replies.create' then return public.testagram_create_local_reply_v2((p_input->>'post_id')::uuid,p_input->>'content',nullif(p_input->>'parent_reply_id','')::uuid);
   else return public.capability_dispatch_legacy(p_capability,p_input);
 end case;
end;
$function$;