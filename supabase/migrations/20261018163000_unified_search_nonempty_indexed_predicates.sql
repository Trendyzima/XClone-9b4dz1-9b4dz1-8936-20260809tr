-- Avoid full-catalog plans for blank queries and keep Top identity matching narrow.
CREATE OR REPLACE FUNCTION public.testagram_search_unified_uncached(p_q text, p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 40, p_offset integer DEFAULT 0, p_sort text DEFAULT 'relevance'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  q text:=btrim(coalesce(p_q,''));
  raw_term text:=btrim(regexp_replace(q,'^[@#]',''));
  term text:=lower(raw_term);
  kind text:=lower(coalesce(p_kind,'all'));
  sort_mode text:=case when lower(coalesce(p_sort,'relevance')) in ('relevance','latest','most_liked','most_viewed') then lower(coalesce(p_sort,'relevance')) else 'relevance' end;
  n integer:=least(50,greatest(1,coalesce(p_limit,40)));
  v_offset integer:=least(1000000,greatest(0,coalesce(p_offset,0)));
  next_offset integer:=null;
  vu jsonb:='[]'; vh jsonb:='[]'; vp jsonb:='[]'; vt jsonb:='[]'; vc jsonb:='[]'; vf jsonb:='[]'; vr jsonb:='[]'; vi jsonb:='[]';
begin
  if term = '' then
    return jsonb_build_object(
      'users','[]'::jsonb,'hashtags','[]'::jsonb,'posts','[]'::jsonb,
      'threads','[]'::jsonb,'communities','[]'::jsonb,'replies','[]'::jsonb,
      'fediverse','[]'::jsonb,'instances','[]'::jsonb,'next_cursor',null
    );
  end if;

  if kind in ('all','people','users','fediverse') then
    if kind = 'all' then
      -- The Top tab only needs identity matches; searching every actor bio here
      -- expands thousands of wide rows. The People tab keeps full bio search.
      select coalesce(jsonb_agg(to_jsonb(x) order by x.match_rank desc,x.follower_count desc nulls last,x.username), '[]')
      into vu from (
        select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified,p.verified_tier,p.follower_count,p.following_count,p.posts_count,
               'testagram'::text origin,null::text actor_uri,null::text domain,
               case when lower(p.username)=term then 100 when lower(p.username) like term||'%' then 80 when lower(coalesce(p.display_name,'')) like term||'%' then 60 else 20 end match_rank
        from profiles p
        where p.account_status='active' and p.discoverable_by_username=true
          and (lower(p.username) like '%'||term||'%' or lower(coalesce(p.display_name,'')) like '%'||term||'%')
        union all
        select a.id,a.username,a.display_name,a.avatar_url,a.bio,false,null::text,0,0,0,
               'fediverse'::text origin,a.actor_uri,a.domain,
               case when lower(a.username)=term then 100 when lower(a.username) like term||'%' then 85 when lower(coalesce(a.display_name,'')) like term||'%' then 65 when lower(coalesce(a.domain,'')) like '%'||term||'%' then 45 else 25 end match_rank
        from federated_actors a
        where lower(coalesce(a.username,'')) like '%'||term||'%'
           or lower(coalesce(a.display_name,'')) like '%'||term||'%'
           or lower(coalesce(a.domain,'')) like '%'||term||'%'
        order by match_rank desc,follower_count desc nulls last,username
        limit n offset v_offset
      ) x;
    else
      select coalesce(jsonb_agg(to_jsonb(x) order by x.match_rank desc,x.follower_count desc nulls last,x.username), '[]')
      into vu from (
        select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified,p.verified_tier,p.follower_count,p.following_count,p.posts_count,
               'testagram'::text origin,null::text actor_uri,null::text domain,
               case when lower(p.username)=term then 100 when lower(p.username) like term||'%' then 80 when lower(coalesce(p.display_name,'')) like term||'%' then 60 else 20 end match_rank
        from profiles p
        where p.account_status='active' and p.discoverable_by_username=true
          and (lower(p.username) like '%'||term||'%' or lower(coalesce(p.display_name,'')) like '%'||term||'%' or lower(coalesce(p.bio,'')) like '%'||term||'%')
        union all
        select a.id,a.username,a.display_name,a.avatar_url,a.bio,false,null::text,0,0,0,
               'fediverse'::text origin,a.actor_uri,a.domain,
               case when lower(a.username)=term then 100 when lower(a.username) like term||'%' then 85 when lower(coalesce(a.display_name,'')) like term||'%' then 65 when lower(coalesce(a.domain,'')) like '%'||term||'%' then 45 else 25 end match_rank
        from federated_actors a
        where lower(coalesce(a.username,'')) like '%'||term||'%'
           or lower(coalesce(a.display_name,'')) like '%'||term||'%'
           or lower(coalesce(a.bio,'')) like '%'||term||'%'
           or lower(coalesce(a.domain,'')) like '%'||term||'%'
        order by match_rank desc,follower_count desc nulls last,username
        limit n offset v_offset
      ) x;
    end if;
  end if;

  if kind in ('all','hashtags','topics') then
    with local_tags as (
      select lower(regexp_replace(h.tag,'^#','')) tag,max(h.id::text) id,max(h.usage_count) usage_count,max(h.post_count) post_count,
             max(h.follower_count) follower_count,max(h.federated_post_count) federated_post_count,max(h.last_used_at) last_used_at,max(h.created_at) created_at
      from hashtags h where lower(regexp_replace(h.tag,'^#','')) like '%'||term||'%' group by 1
    ), mention_tags as (
      select lower(regexp_replace(h.tag,'^#','')) tag,count(*)::bigint remote_count,max(m.created_at) last_used_at
      from federated_hashtag_mentions m join hashtags h on h.id=m.hashtag_id
      where lower(regexp_replace(h.tag,'^#','')) like '%'||term||'%' group by 1
    ), json_tags as (
      -- Federated hashtags are already normalized in federated_hashtag_mentions.
      -- Expanding every JSON tags array on every unified search caused full-table
      -- scans and statement timeouts. Keep the CTE shape but make this source empty;
      -- the normalized mention graph remains the indexed federated hashtag source.
      select null::text tag, 0::bigint remote_count, null::timestamptz last_used_at
      where false
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
      order by total_posts desc,last_used_at desc nulls last,tag limit n offset v_offset
    ) x;
  end if;

  if kind = 'instances' then
    if term = '' then
      -- Avoid aggregating every actor against every instance for an empty query.
      select coalesce(jsonb_agg(to_jsonb(x) order by x.discovered_at desc nulls last,x.domain),'[]') into vi
      from (
        select fi.id,fi.domain,fi.base_url,fi.provider,fi.software,fi.public_timeline_available,fi.discovered_at,
               (select count(*)::bigint from federated_actors a where a.domain=fi.domain) account_count
        from federated_instances fi
        order by fi.discovered_at desc nulls last,fi.domain
        limit n offset v_offset
      ) x;
    else
      -- Match the predicate to the trigram expression indexes; count actors through
      -- the domain btree index rather than forcing a full actor-table hash scan.
      select coalesce(jsonb_agg(to_jsonb(x) order by x.account_count desc nulls last,x.domain),'[]') into vi
      from (
        select fi.id,fi.domain,fi.base_url,fi.provider,fi.software,fi.public_timeline_available,fi.discovered_at,
               count(a.id)::bigint account_count
        from federated_instances fi
        left join federated_actors a on a.domain=fi.domain
        where lower(coalesce(fi.domain,'')) like '%'||term||'%'
           or lower(coalesce(fi.software,'')) like '%'||term||'%'
        group by fi.id
        order by account_count desc nulls last,fi.domain
        limit n offset v_offset
      ) x;
    end if;
  end if;

  if kind in ('all','posts','media','latest','top','fediverse') then
    select coalesce(jsonb_agg((to_jsonb(x) - 'sort_value') order by x.sort_value desc,x.created_at desc nulls last,x.id desc),'[]') into vp
    from (
      select y.*, case when sort_mode='most_liked' then coalesce(y.likes_count,0) when sort_mode='most_viewed' then coalesce(y.views_count,0) when kind='latest' or sort_mode='latest' then 0 else y.match_rank end sort_value
      from (
      select p.id::text id,p.author_id::text author_id,p.content,p.created_at,p.updated_at,p.image_url,p.video_url,p.is_video,p.media_urls,
             p.likes_count,p.reposts_count,p.replies_count,p.views_count,
             jsonb_build_object('id',pr.id,'username',pr.username,'display_name',pr.display_name,'avatar_url',pr.avatar_url,'bio',pr.bio,'verified',pr.verified,'verified_tier',pr.verified_tier) user_profiles,
             'testagram' origin,false is_federated,
             case when term='' then 0 when lower(coalesce(p.content,'')) like '%'||term||'%' then 50 else 0 end match_rank
      from posts p left join profiles pr on pr.id=coalesce(p.author_id,p.user_id)
      where p.deleted_at is null
        and (lower(coalesce(p.content,'')) like '%'||term||'%' or (left(q,1)='#' and exists(select 1 from post_hashtags ph join hashtags h on h.id=ph.hashtag_id where ph.post_id=p.id and lower(regexp_replace(h.tag,'^#',''))=term)))
        and (kind<>'media' or p.image_url is not null or p.video_url is not null or coalesce(array_length(p.media_urls,1),0)>0)
      union all
      select coalesce(f.uri,f.id::text),f.actor_uri,f.content,f.published_at,f.updated_at,null,null,false,'{}'::text[],
             f.like_count,f.announce_count,f.reply_count,f.view_count,
             jsonb_build_object('id',a.id,'username',a.username,'preferredUsername',a.username,'display_name',a.display_name,'name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,'actor_uri',a.actor_uri,'domain',a.domain) user_profiles,
             'fediverse' origin,true is_federated,
             case when term='' then 0 when lower(coalesce(f.content,'')) like '%'||term||'%' or lower(coalesce(f.summary,'')) like '%'||term||'%' then 55 else 0 end match_rank
      from federated_objects f left join federated_actors a on a.actor_uri=f.actor_uri
      where f.deleted_at is null and f.tombstone=false
        and kind not in ('all','fediverse')
        and (lower(coalesce(f.content,'')) like '%'||term||'%' or lower(coalesce(f.summary,'')) like '%'||term||'%' or (left(q,1)='#' and exists(select 1 from jsonb_array_elements(coalesce(f.tags,'[]'::jsonb)) tag where lower(coalesce(tag->>'type',''))='hashtag' and lower(regexp_replace(coalesce(tag->>'name',''),'#','','g'))=term)) or (left(q,1)='#' and exists(select 1 from federated_hashtag_mentions m join hashtags h on h.id=m.hashtag_id where m.object_id=f.id and lower(regexp_replace(h.tag,'^#',''))=term)))
        and (kind<>'media' or jsonb_array_length(coalesce(f.attachments,'[]'))>0)
      ) y
      order by sort_value desc,created_at desc nulls last,id desc
      limit n offset v_offset
    ) x;
  end if;

  if kind in ('all','threads') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into vt
    from (
      select t.id,t.owner_id,t.title,t.body,t.created_at,t.media_urls,t.likes_count,t.reposts_count,t.quotes_count,t.replies_count,t.views_count,
             jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'bio',p.bio,'verified',p.verified) profiles
      from threads t left join profiles p on p.id=t.owner_id
      where t.deleted_at is null and t.visibility='public' and (lower(coalesce(t.title,'')) like '%'||term||'%' or lower(coalesce(t.body,'')) like '%'||term||'%')
      order by t.created_at desc,t.id desc limit n offset v_offset
    ) x;
  end if;

  if kind in ('all','communities') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.member_count desc nulls last,x.created_at desc),'[]') into vc
    from (
      select c.id,c.name,c.slug,c.display_name,c.description,c.icon_url,c.avatar_url,c.member_count,c.post_count,c.created_at
      from communities c
      where lower(c.name) like '%'||term||'%' or lower(coalesce(c.slug,'')) like '%'||term||'%' or lower(coalesce(c.display_name,'')) like '%'||term||'%' or lower(coalesce(c.description,'')) like '%'||term||'%'
      order by c.member_count desc nulls last,c.created_at desc,c.id desc limit n offset v_offset
    ) x;
  end if;

  if kind in ('replies','conversations') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into vr
    from (
      select r.id,r.post_id,r.parent_reply_id,r.content,r.created_at,
             jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'verified',p.verified) user_profiles,
             'reply' type,'testagram' origin
      from replies r left join profiles p on p.id=r.user_id
      where lower(coalesce(r.content,'')) like '%'||term||'%'
      union all
      select tr.id,tr.thread_id,tr.parent_reply_id,tr.content,tr.created_at,
             jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'verified',p.verified),
             'thread_reply','testagram'
      from thread_replies tr left join profiles p on p.id=tr.user_id
      where lower(coalesce(tr.content,'')) like '%'||term||'%'
      union all
      select fr.id,null,null,fr.content,fr.created_at,
             jsonb_build_object('id',a.id,'username',a.username,'display_name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,'actor_uri',a.actor_uri,'domain',a.domain),
             'federated_reply','fediverse'
      from federated_replies fr left join federated_actors a on a.actor_uri=fr.user_id::text
      where lower(coalesce(fr.content,'')) like '%'||term||'%'
      order by created_at desc nulls last,id desc
      limit n offset v_offset
    ) x;
  end if;

  if kind in ('all','fediverse','posts','hashtags','media','latest') then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into vf
    from (
      select f.id,f.uri,f.actor_uri,f.content,f.summary,f.published_at,f.updated_at,f.attachments,f.tags,
             f.like_count,f.announce_count,f.reply_count,f.quote_count,f.object_type,f.url,coalesce(f.published_at,f.updated_at) created_at,
             jsonb_build_object('id',a.id,'username',a.username,'display_name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,'actor_uri',a.actor_uri,'domain',a.domain) remote_account
      from federated_objects f left join federated_actors a on a.actor_uri=f.actor_uri
      where f.deleted_at is null and f.tombstone=false
        and (lower(coalesce(f.content,'')) like '%'||term||'%' or lower(coalesce(f.summary,'')) like '%'||term||'%' or (left(q,1)='#' and exists(select 1 from federated_hashtag_mentions m join hashtags h on h.id=m.hashtag_id where m.object_id=f.id and lower(regexp_replace(h.tag,'^#',''))=term)))
        and (kind<>'media' or jsonb_array_length(coalesce(f.attachments,'[]'))>0)
      order by coalesce(f.published_at,f.updated_at) desc nulls last,f.uri desc limit n offset v_offset
    ) x;
  end if;

  if jsonb_array_length(vu)>=n or jsonb_array_length(vh)>=n or jsonb_array_length(vp)>=n or jsonb_array_length(vt)>=n or jsonb_array_length(vc)>=n or jsonb_array_length(vr)>=n or jsonb_array_length(vf)>=n or jsonb_array_length(vi)>=n then
    next_offset:=v_offset+n;
  end if;
  return jsonb_build_object('users',vu,'hashtags',vh,'posts',vp,'threads',vt,'communities',vc,'replies',vr,'fediverse',vf,'instances',vi,'next_cursor',next_offset::text);
end;
$function$;
