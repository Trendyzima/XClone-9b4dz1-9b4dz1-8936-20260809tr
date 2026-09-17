-- X-style derivative visibility: likes and public trend/hashtag materialization.
drop policy if exists post_likes_authenticated_read on public.post_likes;
create policy post_likes_authenticated_read on public.post_likes
for select to authenticated
using (public.testagram_post_is_visible_to_viewer(post_id,auth.uid()));

create or replace function public.toggle_post_like(p_post_id uuid)
returns table(is_liked boolean,likes_count bigint)
language plpgsql
set search_path=public
as $function$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Not authenticated'; end if;
 if not public.testagram_post_is_visible_to_viewer(p_post_id,uid) then raise exception 'POST_NOT_VISIBLE'; end if;
 if exists(select 1 from public.post_likes where user_id=uid and post_id=p_post_id) then
   delete from public.post_likes where user_id=uid and post_id=p_post_id;
 else
   insert into public.post_likes(user_id,post_id) values(uid,p_post_id) on conflict(user_id,post_id) do nothing;
 end if;
 return query
 select exists(select 1 from public.post_likes where user_id=uid and post_id=p_post_id),
        (select count(*)::bigint from public.post_likes where post_id=p_post_id);
end;
$function$;

-- The scheduled/public trend materializer must only use native posts visible to an
-- anonymous/public viewer. Remote Fediverse objects retain their own visibility model.
do $$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='refresh_trending_topics' limit 1;
 if src is null then raise exception 'refresh_trending_topics not found'; end if;
 src:=replace(src,'coalesce(p.visibility,''public'') in (''public'',''unlisted'')','public.testagram_post_is_visible_to_viewer(p.id,null)');
 if position('public.testagram_post_is_visible_to_viewer(p.id,null)' in src)=0 then
   raise exception 'refresh_trending_topics visibility patch failed';
 end if;
 execute src;
end $$;

-- Public hashtag search must derive native counts from posts visible to this viewer,
-- rather than exposing stale aggregate counters that may include protected posts.
do $$
declare src text; old text; new text;
begin
 select pg_get_functiondef(p.oid) into src
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='capability_dispatch' limit 1;
 old:=$old$
      select id,tag,post_count,usage_count,follower_count,last_used_at from public.hashtags
      where tag ilike '%'||v_text||'%' order by coalesce(usage_count,post_count) desc nulls last,tag limit v_limit offset v_offset
$old$;
 new:=$new$
      select h.id,h.tag,
        (select count(*)::bigint from public.post_hashtags ph join public.posts p on p.id=ph.post_id
         where ph.hashtag_id=h.id and public.testagram_post_is_visible_to_viewer(p.id,u)) as post_count,
        (select count(*)::bigint from public.post_hashtags ph join public.posts p on p.id=ph.post_id
         where ph.hashtag_id=h.id and public.testagram_post_is_visible_to_viewer(p.id,u)) as usage_count,
        h.follower_count,h.last_used_at
      from public.hashtags h
      where h.tag ilike '%'||v_text||'%'
      order by post_count desc nulls last,h.tag
      limit v_limit offset v_offset
$new$;
 if src is null or position(old in src)=0 then raise exception 'capability_dispatch hashtag search block not found'; end if;
 execute replace(src,old,new);
end $$;
