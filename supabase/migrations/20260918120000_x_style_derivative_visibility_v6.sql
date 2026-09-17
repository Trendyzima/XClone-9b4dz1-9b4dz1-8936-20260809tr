-- Final derivative visibility sweep: replies, media, hashtag membership, follows and lists.
drop policy if exists post_replies_public_read on public.post_replies;
create policy post_replies_public_read on public.post_replies for select to anon,authenticated
using (exists(select 1 from public.posts p where p.id=post_replies.post_id and public.testagram_post_is_visible_to_viewer(p.id,auth.uid())));

drop policy if exists post_media_public_read on public.post_media;
create policy post_media_public_read on public.post_media for select to anon,authenticated
using (exists(select 1 from public.posts p where p.id=post_media.post_id and public.testagram_post_is_visible_to_viewer(p.id,auth.uid())));

drop policy if exists post_hashtags_read on public.post_hashtags;
create policy post_hashtags_read on public.post_hashtags for select to anon,authenticated
using (exists(select 1 from public.posts p where p.id=post_hashtags.post_id and public.testagram_post_is_visible_to_viewer(p.id,auth.uid())));

drop policy if exists follows_public_read on public.follows;
drop policy if exists follows_read on public.follows;
drop policy if exists follows_select_own on public.follows;
create policy follows_public_read on public.follows for select to anon,authenticated
using (status='accepted' and exists(select 1 from public.profiles pr where pr.id=follows.following_id and pr.discoverable_by_username=true));

drop policy if exists lists_select on public.lists;
drop policy if exists lists_read on public.lists;
create policy lists_select on public.lists for select to authenticated using (owner_id=auth.uid() or not is_private);

drop policy if exists list_members_select on public.list_members;
drop policy if exists list_members_read on public.list_members;
create policy list_members_select on public.list_members for select to authenticated
using (exists(select 1 from public.lists l where l.id=list_members.list_id and (l.owner_id=auth.uid() or not l.is_private)));

create or replace function public.get_unified_hashtag_feed(p_tag text,p_limit integer default 40)
returns table(kind text,id text,content text,url text,actor_uri text,created_at timestamptz,source text)
language sql security definer set search_path=public as $function$
with q as (select lower(regexp_replace(trim(coalesce(p_tag,'')),'^#+','')) tag,least(greatest(coalesce(p_limit,40),1),80) lim),
native_posts as (
 select 'post'::text,p.id::text,coalesce(p.content,p.body,''),null::text,null::text,p.created_at,'testagram'::text
 from post_hashtags ph join hashtags h on h.id=ph.hashtag_id join posts p on p.id=ph.post_id cross join q
 where h.tag=q.tag and public.testagram_post_is_visible_to_viewer(p.id,auth.uid())
),
canonical_fed_posts as (
 select 'fediverse_post'::text,fo.id::text,coalesce(fo.object->>'content',fo.object->>'name',fo.object->>'summary',''),
 coalesce(fo.object->>'url',fo.object_url),coalesce(fo.actor_url,fo.object->>'attributedTo'),coalesce(fo.published_at,(fo.object->>'published')::timestamptz),'fediverse'::text
 from federation_objects fo cross join q where coalesce(fo.object_type,'Note') in ('Note','Article','Video','Question')
 and coalesce((fo.object->>'sensitive')::boolean,false)=false
 and (exists(select 1 from jsonb_array_elements(case when jsonb_typeof(fo.object->'tag')='array' then fo.object->'tag' else '[]'::jsonb end)t where lower(regexp_replace(coalesce(t->>'name',''),'^#+',''))=q.tag)
 or lower(coalesce(fo.object->>'content','')) like '%'||('#'||q.tag)||'%' or lower(coalesce(fo.object->>'content','')) like '%'||q.tag||'%')
),
legacy_fed_posts as (
 select 'fediverse_post'::text,o.id::text,coalesce(o.content,o.summary,''),coalesce(o.url,o.uri),o.actor_uri,coalesce(o.published_at,o.created_at),'fediverse'::text
 from federated_objects o cross join q where not o.sensitive and o.deleted_at is null
 and (exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.tags)='array' then o.tags else '[]'::jsonb end)t where lower(regexp_replace(coalesce(t->>'name',t#>>'{}'),'^#+',''))=q.tag)
 or lower(coalesce(o.content,'')) like '%'||('#'||q.tag)||'%' or lower(coalesce(o.content,'')) like '%'||q.tag||'%')
)
select * from native_posts union all select * from canonical_fed_posts union all select * from legacy_fed_posts order by created_at desc nulls last limit(select lim from q);
$function$;