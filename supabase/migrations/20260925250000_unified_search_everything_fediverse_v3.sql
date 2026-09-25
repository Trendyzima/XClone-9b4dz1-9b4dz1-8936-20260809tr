-- Unified search v3: local Testagram + indexed Fediverse actors/content + hashtag graph + replies.
create index if not exists profiles_search_username_lower_idx on public.profiles (lower(username)) where account_status='active' and discoverable_by_username=true;
create index if not exists federated_actors_search_username_lower_idx on public.federated_actors (lower(username));
create index if not exists federated_actors_search_domain_lower_idx on public.federated_actors (lower(domain));
create index if not exists posts_search_created_idx on public.posts (created_at desc) where deleted_at is null;
create index if not exists replies_search_created_idx on public.replies (created_at desc);
create index if not exists thread_replies_search_created_idx on public.thread_replies (created_at desc);
create index if not exists federated_replies_search_created_idx on public.federated_replies (created_at desc);
create index if not exists federated_objects_search_published_idx on public.federated_objects (published_at desc) where deleted_at is null and tombstone=false;

CREATE OR REPLACE FUNCTION public.testagram_search_unified(p_q text, p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  q text:=btrim(coalesce(p_q,''));
  raw_term text:=btrim(regexp_replace(q,'^[@#]',''));
  term text:=lower(raw_term);
  kind text:=lower(coalesce(p_kind,'all'));
  n integer:=least(50,greatest(1,coalesce(p_limit,40)));
  vu jsonb:='[]'; vh jsonb:='[]'; vp jsonb:='[]'; vt jsonb:='[]'; vc jsonb:='[]'; vf jsonb:='[]'; vr jsonb:='[]';
begin
  if kind in ('all','people','users','fediverse') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.match_rank desc,x.follower_count desc nulls last,x.username), '[]')
    into vu from (
      select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified,p.verified_tier,p.follower_count,p.following_count,p.posts_count,
             'testagram'::text origin,null::text actor_uri,null::text domain,
             case when term='' then 0 when lower(p.username)=term then 100 when lower(p.username) like term||'%' then 80 when lower(coalesce(p.display_name,'')) like term||'%' then 60 else 20 end match_rank
      from profiles p
      where p.account_status='active' and p.discoverable_by_username=true
        and (term='' or lower(p.username) like '%'||term||'%' or lower(coalesce(p.display_name,'')) like '%'||term||'%' or lower(coalesce(p.bio,'')) like '%'||term||'%')
      union all
      select a.id,a.username,a.display_name,a.avatar_url,a.bio,false,null::text,0,0,0,
             'fediverse'::text origin,a.actor_uri,a.domain,
             case when term='' then 0 when lower(a.username)=term then 100 when lower(a.username) like term||'%' then 85 when lower(coalesce(a.display_name,'')) like term||'%' then 65 when lower(coalesce(a.domain,'')) like '%'||term||'%' then 45 else 25 end match_rank
      from federated_actors a
      where term='' or lower(coalesce(a.username,'')) like '%'||term||'%' or lower(coalesce(a.display_name,'')) like '%'||term||'%' or lower(coalesce(a.bio,'')) like '%'||term||'%' or lower(coalesce(a.domain,'')) like '%'||term||'%'
      order by match_rank desc, follower_count desc nulls last, username
      limit n
    ) x;
  end if;

  if kind in ('all','hashtags','topics') then
    with local_tags as (
      select lower(regexp_replace(h.tag,'^#','')) tag,max(h.id::text) id,max(h.usage_count) usage_count,max(h.post_count) post_count,
             max(h.follower_count) follower_count,max(h.federated_post_count) federated_post_count,max(h.last_used_at) last_used_at,max(h.created_at) created_at
      from hashtags h where term='' or lower(regexp_replace(h.tag,'^#','')) like '%'||term||'%' group by 1
    ), mention_tags as (
      select lower(regexp_replace(h.tag,'^#','')) tag,count(*)::bigint remote_count,max(m.created_at) last_used_at
      from federated_hashtag_mentions m join hashtags h on h.id=m.hashtag_id
      where term='' or lower(regexp_replace(h.tag,'^#','')) like '%'||term||'%' group by 1
    ), json_tags as (
      select lower(regexp_replace(coalesce(x.value->>'name',''),'#','','g')) tag,count(*)::bigint remote_count,max(coalesce(f.published_at,f.updated_at)) last_used_at
      from federated_objects f cross join lateral jsonb_array_elements(coalesce(f.tags,'[]'::jsonb)) x(value)
      where f.deleted_at is null and f.tombstone=false and lower(coalesce(x.value->>'type',''))='hashtag'
        and (term='' or lower(regexp_replace(coalesce(x.value->>'name',''),'#','','g')) like '%'||term||'%') group by 1
    ), remote_tags as (
      select tag,sum(remote_count)::bigint remote_count,max(last_used_at) last_used_at
      from (select * from mention_tags union all select * from json_tags) s group by tag
    )
    select coalesce(jsonb_agg(to_jsonb(x) order by x.total_posts desc,x.last_used_at desc nulls last,x.tag),'[]') into vh
    from (
      select coalesce(l.tag,r.tag) tag,
             coalesce(l.id,('00000000-0000-0000-0000-'||substr(md5(coalesce(l.tag,r.tag)),1,12))::uuid::text) id,
             coalesce(l.usage_count,0) usage_count,coalesce(l.post_count,0) post_count,coalesce(l.follower_count,0) follower_count,
             coalesce(l.federated_post_count,0)+coalesce(r.remote_count,0) federated_post_count,
             coalesce(l.last_used_at,r.last_used_at,now()) last_used_at,coalesce(l.created_at,now()) created_at,
             coalesce(l.post_count,0)+coalesce(l.federated_post_count,0)+coalesce(r.remote_count,0) total_posts,
             case when r.tag is not null and l.tag is not null then 'mixed' when r.tag is not null then 'fediverse' else 'testagram' end origin
      from local_tags l full join remote_tags r on r.tag=l.tag
    ) x;
  end if;

  if kind in ('all','posts','media','latest','top','fediverse') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.match_rank desc,x.created_at desc),'[]') into vp
    from (
      select p.id,p.author_id::text author_id,p.content,p.created_at,p.updated_at,p.image_url,p.video_url,p.is_video,p.media_urls,
             p.likes_count,p.reposts_count,p.replies_count,p.views_count,
             jsonb_build_object('id',pr.id,'username',pr.username,'display_name',pr.display_name,'avatar_url',pr.avatar_url,'bio',pr.bio,'verified',pr.verified,'verified_tier',pr.verified_tier) user_profiles,
             'testagram' origin,false is_federated,
             case when term='' then 0 when lower(coalesce(p.content,'')) like '%'||term||'%' then 50 else 0 end match_rank
      from posts p left join profiles pr on pr.id=coalesce(p.author_id,p.user_id)
      where p.deleted_at is null
        and (term='' or lower(coalesce(p.content,'')) like '%'||term||'%' or (left(q,1)='#' and exists(select 1 from post_hashtags ph join hashtags h on h.id=ph.hashtag_id where ph.post_id=p.id and lower(regexp_replace(h.tag,'^#',''))=term)))
        and (kind<>'media' or p.image_url is not null or p.video_url is not null or coalesce(array_length(p.media_urls,1),0)>0)
      union all
      select f.id,f.actor_uri,f.content,f.published_at,f.updated_at,null,null,false,'{}'::text[],
             f.like_count,f.announce_count,f.reply_count,f.view_count,
             jsonb_build_object('id',a.id,'username',a.username,'preferredUsername',a.username,'display_name',a.display_name,'name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,'actor_uri',a.actor_uri,'domain',a.domain) user_profiles,
             'fediverse' origin,true is_federated,
             case when term='' then 0 when lower(coalesce(f.content,'')) like '%'||term||'%' or lower(coalesce(f.summary,'')) like '%'||term||'%' then 55 else 0 end match_rank
      from federated_objects f left join federated_actors a on a.actor_uri=f.actor_uri
      where f.deleted_at is null and f.tombstone=false
        and (term='' or lower(coalesce(f.content,'')) like '%'||term||'%' or lower(coalesce(f.summary,'')) like '%'||term||'%' or (left(q,1)='#' and exists(select 1 from jsonb_array_elements(coalesce(f.tags,'[]'::jsonb)) tag where lower(coalesce(tag->>'type',''))='hashtag' and lower(regexp_replace(coalesce(tag->>'name',''),'#','','g'))=term)) or (left(q,1)='#' and exists(select 1 from federated_hashtag_mentions m join hashtags h on h.id=m.hashtag_id where m.object_id=f.id and lower(regexp_replace(h.tag,'^#',''))=term)))
        and (kind<>'media' or jsonb_array_length(coalesce(f.attachments,'[]'))>0)
      order by match_rank desc,created_at desc
      limit n
    ) x;
  end if;

  if kind in ('all','threads') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into vt
    from (
      select t.id,t.owner_id,t.title,t.body,t.created_at,t.media_urls,t.likes_count,t.reposts_count,t.quotes_count,t.replies_count,t.views_count,
             jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'bio',p.bio,'verified',p.verified) profiles
      from threads t left join profiles p on p.id=t.owner_id
      where t.deleted_at is null and t.visibility='public' and (term='' or lower(coalesce(t.title,'')) like '%'||term||'%' or lower(coalesce(t.body,'')) like '%'||term||'%')
      order by t.created_at desc limit n
    ) x;
  end if;

  if kind in ('all','communities') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.member_count desc nulls last,x.created_at desc),'[]') into vc
    from (
      select c.id,c.name,c.slug,c.display_name,c.description,c.icon_url,c.avatar_url,c.member_count,c.post_count,c.created_at
      from communities c
      where term='' or lower(c.name) like '%'||term||'%' or lower(coalesce(c.slug,'')) like '%'||term||'%' or lower(coalesce(c.display_name,'')) like '%'||term||'%' or lower(coalesce(c.description,'')) like '%'||term||'%'
      order by c.member_count desc nulls last,c.created_at desc limit n
    ) x;
  end if;

  if kind in ('all','replies','conversations') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into vr
    from (
      select r.id,r.post_id,r.parent_reply_id,r.content,r.created_at,
             jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'verified',p.verified) user_profiles,
             'reply' type,'testagram' origin
      from replies r left join profiles p on p.id=r.user_id
      where term='' or lower(coalesce(r.content,'')) like '%'||term||'%'
      union all
      select tr.id,tr.thread_id,tr.parent_reply_id,tr.content,tr.created_at,
             jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'verified',p.verified),
             'thread_reply','testagram'
      from thread_replies tr left join profiles p on p.id=tr.user_id
      where term='' or lower(coalesce(tr.content,'')) like '%'||term||'%'
      union all
      select fr.id,null,null,fr.content,fr.created_at,
             jsonb_build_object('id',a.id,'username',a.username,'display_name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,'actor_uri',a.actor_uri,'domain',a.domain),
             'federated_reply','fediverse'
      from federated_replies fr left join federated_actors a on a.actor_uri=fr.user_id::text
      where term='' or lower(coalesce(fr.content,'')) like '%'||term||'%'
      limit n
    ) x;
  end if;

  if kind in ('all','fediverse','posts','hashtags','media') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into vf
    from (
      select f.id,f.uri,f.actor_uri,f.content,f.summary,f.published_at,f.updated_at,f.attachments,f.tags,
             f.like_count,f.announce_count,f.reply_count,f.quote_count,f.object_type,f.url,coalesce(f.published_at,f.updated_at) created_at,
             jsonb_build_object('id',a.id,'username',a.username,'display_name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,'actor_uri',a.actor_uri,'domain',a.domain) remote_account
      from federated_objects f left join federated_actors a on a.actor_uri=f.actor_uri
      where f.deleted_at is null and f.tombstone=false
        and (term='' or lower(coalesce(f.content,'')) like '%'||term||'%' or lower(coalesce(f.summary,'')) like '%'||term||'%' or (left(q,1)='#' and exists(select 1 from federated_hashtag_mentions m join hashtags h on h.id=m.hashtag_id where m.object_id=f.id and lower(regexp_replace(h.tag,'^#',''))=term)))
        and (kind<>'media' or jsonb_array_length(coalesce(f.attachments,'[]'))>0)
      order by coalesce(f.published_at,f.updated_at) desc nulls last limit n
    ) x;
  end if;

  return jsonb_build_object('users',vu,'hashtags',vh,'posts',vp,'threads',vt,'communities',vc,'replies',vr,'fediverse',vf,'next_cursor',null);
end;
$function$


revoke all on function public.testagram_search_unified(text,text,integer) from public,anon;
grant execute on function public.testagram_search_unified(text,text,integer) to authenticated;