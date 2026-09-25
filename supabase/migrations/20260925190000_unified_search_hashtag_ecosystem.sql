-- Unified ecosystem search + canonical hashtag surfaces.
-- Every search result is addressable by its native object id while hashtags
-- resolve through the single public.hashtags registry for local and federated content.

insert into public.capability_registry(name,version,access,readonly,description)
values ('testagram.search.unified',1,'authenticated',true,'Unified search across profiles, posts, threads, communities, hashtags and indexed Fediverse objects.')
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=true,updated_at=now();

create or replace function public.testagram_search_unified(p_q text,p_kind text default 'all',p_limit integer default 40)
returns jsonb language plpgsql security invoker set search_path=public
as $$
declare
 q text:=btrim(coalesce(p_q,'')); kind text:=lower(coalesce(p_kind,'all')); n integer:=least(50,greatest(1,coalesce(p_limit,40)));
 vu jsonb:='[]'; vh jsonb:='[]'; vp jsonb:='[]'; vt jsonb:='[]'; vc jsonb:='[]'; vf jsonb:='[]';
begin
 if kind in ('all','people','users') then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vu from (select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.verified,p.verified_tier,p.follower_count,p.following_count,p.posts_count from profiles p where p.account_status='active' and p.discoverable_by_username=true and (q='' or lower(p.username) like '%'||lower(q)||'%' or lower(coalesce(p.display_name,'')) like '%'||lower(q)||'%') order by p.follower_count desc nulls last,p.created_at desc limit n)x; end if;
 if kind in ('all','hashtags','topics') then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vh from (select h.id,h.tag,h.usage_count,h.post_count,h.follower_count,h.federated_post_count,h.last_used_at,h.created_at from hashtags h where q='' or lower(h.tag) like '%'||lower(replace(q,'#',''))||'%' order by coalesce(h.post_count,0)+coalesce(h.federated_post_count,0) desc,h.last_used_at desc nulls last limit n)x; end if;
 if kind in ('all','posts','media','latest','top') then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vp from (select p.id,p.author_id,p.content,p.created_at,p.updated_at,p.image_url,p.video_url,p.is_video,p.media_urls,p.likes_count,p.reposts_count,p.replies_count,p.views_count from posts p where p.deleted_at is null and (q='' or lower(coalesce(p.content,'')) like '%'||lower(q)||'%') and (kind<>'media' or p.image_url is not null or p.video_url is not null or coalesce(array_length(p.media_urls,1),0)>0) order by case when kind='top' then coalesce(p.likes_count,0)+coalesce(p.reposts_count,0)+coalesce(p.replies_count,0) else 0 end desc,p.created_at desc limit n)x; end if;
 if kind in ('all','threads') then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vt from (select t.id,t.owner_id,t.body,t.created_at,t.media_urls,t.likes_count,t.reposts_count,t.replies_count,t.quotes_count,t.views_count from threads t where t.deleted_at is null and t.visibility='public' and (q='' or lower(coalesce(t.body,'')) like '%'||lower(q)||'%') order by t.created_at desc limit n)x; end if;
 if kind in ('all','communities') then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vc from (select c.id,c.name,c.display_name,c.description,c.icon_url,c.member_count,c.created_at from communities c where q='' or lower(c.name) like '%'||lower(q)||'%' or lower(coalesce(c.description,'')) like '%'||lower(q)||'%' or lower(coalesce(c.display_name,'')) like '%'||lower(q)||'%' order by c.member_count desc nulls last limit n)x; end if;
 if kind in ('all','fediverse','posts','hashtags','media') then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into vf from (select f.id,f.uri,f.actor_uri,f.content,f.summary,f.published_at,f.updated_at,f.attachments,f.tags,f.like_count,f.announce_count,f.reply_count,f.object_type,f.url from federated_objects f where f.deleted_at is null and f.tombstone=false and (q='' or lower(coalesce(f.content,'')) like '%'||lower(q)||'%' or lower(coalesce(f.summary,'')) like '%'||lower(q)||'%') and (kind<>'media' or jsonb_array_length(coalesce(f.attachments,'[]'))>0) order by coalesce(f.published_at,f.updated_at) desc nulls last limit n)x; end if;
 return jsonb_build_object('users',vu,'hashtags',vh,'posts',vp,'threads',vt,'communities',vc,'fediverse',vf,'next_cursor',null);
end $$;
revoke all on function public.testagram_search_unified(text,text,integer) from public,anon;
grant execute on function public.testagram_search_unified(text,text,integer) to authenticated;

do $$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' and pg_get_function_identity_arguments(p.oid)='p_capability text, p_input jsonb';
 if src is null then raise exception 'CAPABILITY_DISPATCH_NOT_FOUND'; end if;
 if position('when ''testagram.search.unified'' then' in src)=0 then
   src:=replace(src,'else return public.capability_dispatch_legacy(p_capability,p_input);','when ''testagram.search.unified'' then return public.testagram_search_unified(p_input->>''q'',p_input->>''kind'',coalesce((p_input->>''limit'')::integer,40));'||E'\n'||'else return public.capability_dispatch_legacy(p_capability,p_input);');
   execute src;
 end if;
end $$;
revoke all on function public.capability_dispatch(text,jsonb) from public;
grant execute on function public.capability_dispatch(text,jsonb) to anon,authenticated;

create index if not exists hashtags_tag_lower_idx on public.hashtags(lower(tag));
create index if not exists federated_objects_published_idx on public.federated_objects(published_at desc) where deleted_at is null and tombstone=false;
create index if not exists threads_created_public_idx on public.threads(created_at desc) where deleted_at is null and visibility='public';
