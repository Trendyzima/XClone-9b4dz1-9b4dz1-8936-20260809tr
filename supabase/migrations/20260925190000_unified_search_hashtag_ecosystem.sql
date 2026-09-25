-- Unified ecosystem search + canonical hashtag surfaces.
-- Every search result is addressable by its native object id while hashtags
-- resolve through the single public.hashtags registry for local and federated content.

insert into public.capability_registry(name,version,access,readonly,description)
values ('testagram.search.unified',1,'authenticated',true,'Unified search across profiles, posts, threads, communities, hashtags and indexed Fediverse objects.')
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=true,updated_at=now();

create or replace function public.capability_dispatch(p_capability text,p_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security invoker set search_path=public
as $$
declare
 v_user_id uuid:=auth.uid();
 v_q text:=btrim(coalesce(p_input->>'q',''));
 v_limit int:=least(50,greatest(1,coalesce((p_input->>'limit')::int,20)));
 v_kind text:=lower(coalesce(p_input->>'kind','all'));
begin
 if p_capability='testagram.search.unified' then
   if v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
   return jsonb_build_object(
    'users',case when v_kind in ('all','people','users') then coalesce((select jsonb_agg(to_jsonb(x)) from (
      select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified,p.verified_tier,p.follower_count,p.following_count,p.posts_count
      from public.profiles p
      where p.account_status='active' and p.discoverable_by_username=true
        and (v_q='' or lower(p.username) like '%'||lower(v_q)||'%' or lower(coalesce(p.display_name,'')) like '%'||lower(v_q)||'%')
      order by p.follower_count desc nulls last,p.created_at desc limit v_limit) x),'[]'::jsonb) else '[]'::jsonb end,
    'hashtags',case when v_kind in ('all','hashtags','topics') then coalesce((select jsonb_agg(to_jsonb(x)) from (
      select h.id,h.tag,h.usage_count,h.post_count,h.follower_count,h.federated_post_count,h.last_used_at,h.created_at
      from public.hashtags h
      where v_q='' or lower(h.tag) like '%'||lower(replace(v_q,'#',''))||'%'
      order by (coalesce(h.post_count,0)+coalesce(h.federated_post_count,0)) desc,h.last_used_at desc nulls last
      limit v_limit) x),'[]'::jsonb) else '[]'::jsonb end,
    'posts',case when v_kind in ('all','posts','media','latest','top') then coalesce((select jsonb_agg(to_jsonb(x)) from (
      select p.id,p.author_id,p.content,p.created_at,p.updated_at,p.image_url,p.video_url,p.is_video,p.media_urls,p.likes_count,p.reposts_count,p.replies_count,p.quotes_count,p.views_count,p.visibility
      from public.posts p
      where p.deleted_at is null and p.visibility='public'
        and (v_q='' or lower(coalesce(p.content,'')) like '%'||lower(v_q)||'%')
        and (v_kind<>'media' or p.image_url is not null or p.video_url is not null or coalesce(array_length(p.media_urls,1),0)>0)
      order by case when v_kind='top' then coalesce(p.likes_count,0)+coalesce(p.reposts_count,0)+coalesce(p.replies_count,0) else 0 end desc,p.created_at desc
      limit v_limit) x),'[]'::jsonb) else '[]'::jsonb end,
    'threads',case when v_kind in ('all','threads') then coalesce((select jsonb_agg(to_jsonb(x)) from (
      select t.id,t.owner_id,t.body,t.created_at,t.media_urls,t.likes_count,t.reposts_count,t.replies_count,t.quotes_count,t.views_count
      from public.threads t
      where t.deleted_at is null and t.visibility='public' and (v_q='' or lower(coalesce(t.body,'')) like '%'||lower(v_q)||'%')
      order by t.created_at desc limit v_limit) x),'[]'::jsonb) else '[]'::jsonb end,
    'communities',case when v_kind in ('all','communities') then coalesce((select jsonb_agg(to_jsonb(x)) from (
      select c.id,c.name,c.display_name,c.description,c.icon_url,c.member_count,c.created_at
      from public.communities c
      where v_q='' or lower(c.name) like '%'||lower(v_q)||'%' or lower(coalesce(c.display_name,'')) like '%'||lower(v_q)||'%' or lower(coalesce(c.description,'')) like '%'||lower(v_q)||'%'
      order by c.member_count desc nulls last limit v_limit) x),'[]'::jsonb) else '[]'::jsonb end,
    'fediverse',case when v_kind in ('all','fediverse','posts','hashtags','media') then coalesce((select jsonb_agg(to_jsonb(x)) from (
      select f.id,f.uri,f.actor_uri,f.content,f.summary,f.published_at,f.updated_at,f.attachments,f.tags,f.like_count,f.announce_count,f.reply_count,f.object_type,f.url
      from public.federated_objects f
      where f.deleted_at is null and f.tombstone=false
        and (v_q='' or lower(coalesce(f.content,'')) like '%'||lower(v_q)||'%' or lower(coalesce(f.summary,'')) like '%'||lower(v_q)||'%')
        and (v_kind<>'media' or jsonb_array_length(coalesce(f.attachments,'[]'::jsonb))>0)
      order by coalesce(f.published_at,f.updated_at) desc nulls last limit v_limit) x),'[]'::jsonb) else '[]'::jsonb end,
    'next_cursor',null
   );
 end if;
 return public.capability_dispatch(p_capability,p_input);
end $$;

revoke all on function public.capability_dispatch(text,jsonb) from public;
grant execute on function public.capability_dispatch(text,jsonb) to anon,authenticated;

create index if not exists hashtags_tag_lower_idx on public.hashtags(lower(tag));
create index if not exists federated_objects_published_idx on public.federated_objects(published_at desc) where deleted_at is null and tombstone=false;
create index if not exists threads_created_public_idx on public.threads(created_at desc) where deleted_at is null and visibility='public';
