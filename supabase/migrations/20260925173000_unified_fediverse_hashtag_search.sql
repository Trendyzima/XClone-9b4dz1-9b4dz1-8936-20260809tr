-- Keep hashtag discovery unified across local Testagram posts and cached ActivityPub objects.
-- Remote-only hashtags are virtual search results; canonical local hashtags keep their UUID.
create or replace function public.testagram_search_unified(p_q text, p_kind text default 'all', p_limit integer default 40)
returns jsonb language plpgsql set search_path=public as $function$
declare
 q text:=btrim(coalesce(p_q,'')); kind text:=lower(coalesce(p_kind,'all')); n integer:=least(50,greatest(1,coalesce(p_limit,40)));
 vu jsonb:='[]'; vh jsonb:='[]'; vp jsonb:='[]'; vt jsonb:='[]'; vc jsonb:='[]'; vf jsonb:='[]';
begin
 if kind in ('all','people','users') then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vu from (
   select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified,p.verified_tier,p.follower_count,p.following_count,p.posts_count
   from profiles p where p.account_status='active' and p.discoverable_by_username=true
   and (q='' or lower(p.username) like '%'||lower(q)||'%' or lower(coalesce(p.display_name,'')) like '%'||lower(q)||'%')
   order by p.follower_count desc nulls last,p.created_at desc limit n)x;
 end if;
 if kind in ('all','hashtags','topics') then
  with local_tags as (
   select lower(regexp_replace(h.tag,'^#','')) tag,max(h.id::text) id,max(h.usage_count) usage_count,max(h.post_count) post_count,max(h.follower_count) follower_count,max(h.federated_post_count) federated_post_count,max(h.last_used_at) last_used_at,max(h.created_at) created_at
   from hashtags h where q='' or lower(h.tag) like '%'||lower(replace(q,'#',''))||'%' group by lower(regexp_replace(h.tag,'^#',''))
  ), remote_tags as (
   select lower(regexp_replace(coalesce(x.value->>'name',''),'#','','g')) tag,count(*)::bigint remote_count
   from federated_objects f cross join lateral jsonb_array_elements(coalesce(f.tags,'[]'::jsonb)) x(value)
   where f.deleted_at is null and f.tombstone=false and lower(coalesce(x.value->>'type',''))='hashtag'
   and (q='' or lower(regexp_replace(coalesce(x.value->>'name',''),'#','','g')) like '%'||lower(replace(q,'#',''))||'%')
   group by 1
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.total_posts desc,x.last_used_at desc nulls last,x.tag), '[]') into vh
  from (
   select coalesce(l.tag,r.tag) tag,
    coalesce(l.id,('00000000-0000-0000-0000-'||substr(md5(coalesce(l.tag,r.tag)),1,12))::uuid) id,
    coalesce(l.usage_count,0) usage_count,coalesce(l.post_count,0) post_count,coalesce(l.follower_count,0) follower_count,
    coalesce(l.federated_post_count,0)+coalesce(r.remote_count,0) federated_post_count,
    coalesce(l.last_used_at,now()) last_used_at,coalesce(l.created_at,now()) created_at,
    coalesce(l.post_count,0)+coalesce(l.federated_post_count,0)+coalesce(r.remote_count,0) total_posts,
    case when r.tag is not null and l.tag is not null then 'mixed' when r.tag is not null then 'fediverse' else 'testagram' end origin
   from local_tags l full join remote_tags r on r.tag=l.tag
  )x limit n;
 end if;
 if kind in ('all','posts','media','latest','top') then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vp from (
   select p.id,p.author_id,p.content,p.created_at,p.updated_at,p.image_url,p.video_url,p.is_video,p.media_urls,p.likes_count,p.reposts_count,p.replies_count,p.views_count
   from posts p where p.deleted_at is null and (q='' or lower(coalesce(p.content,'')) like '%'||lower(q)||'%')
   and (kind<>'media' or p.image_url is not null or p.video_url is not null or coalesce(array_length(p.media_urls,1),0)>0)
   order by case when kind='top' then coalesce(p.likes_count,0)+coalesce(p.reposts_count,0)+coalesce(p.replies_count,0) else 0 end desc,p.created_at desc limit n)x;
 end if;
 if kind in ('all','threads') then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vt from (
   select t.id,t.owner_id,t.body,t.created_at,t.media_urls,t.likes_count,t.reposts_count,t.replies_count,t.quotes_count,t.views_count
   from threads t where t.deleted_at is null and t.visibility='public' and (q='' or lower(coalesce(t.body,'')) like '%'||lower(q)||'%') order by t.created_at desc limit n)x;
 end if;
 if kind in ('all','communities') then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vc from (
   select c.id,c.name,c.display_name,c.description,c.icon_url,c.member_count,c.created_at
   from communities c where q='' or lower(c.name) like '%'||lower(q)||'%' or lower(coalesce(c.description,'')) like '%'||lower(q)||'%' order by c.member_count desc nulls last limit n)x;
 end if;
 if kind in ('all','fediverse','posts','hashtags','media') then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vf from (
   select f.id,f.uri,f.actor_uri,f.content,f.summary,f.published_at,f.updated_at,f.attachments,f.tags,f.like_count,f.announce_count,f.reply_count,f.object_type,f.url
   from federated_objects f where f.deleted_at is null and f.tombstone=false
   and (q='' or lower(coalesce(f.content,'')) like '%'||lower(q)||'%' or lower(coalesce(f.summary,'')) like '%'||lower(q)||'%')
   and (kind<>'media' or jsonb_array_length(coalesce(f.attachments,'[]'))>0)
   order by coalesce(f.published_at,f.updated_at) desc nulls last limit n)x;
 end if;
 return jsonb_build_object('users',vu,'hashtags',vh,'posts',vp,'threads',vt,'communities',vc,'fediverse',vf,'next_cursor',null);
end $function$;