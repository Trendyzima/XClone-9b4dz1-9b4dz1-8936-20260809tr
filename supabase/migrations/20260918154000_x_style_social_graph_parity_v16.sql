-- X-style social graph parity v16
-- Canonical follower/following/mutual projections and list-member privacy.

create or replace function public.testagram_followers_list(p_user_id uuid,p_limit int default 50,p_offset int default 0)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare u uuid:=auth.uid(); v jsonb; lim int:=greatest(1,least(coalesce(p_limit,50),50)); off int:=greatest(0,coalesce(p_offset,0));
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.testagram_profile_is_visible_to_viewer(p_user_id) then raise exception 'PROFILE_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v from (
  select pr.id,pr.username,pr.display_name,pr.avatar_url,pr.bio,(pr.verified_tier is not null and pr.verified_tier<>'none') verified,pr.follower_count followers_count,pr.following_count following_count,pr.protected_account is_protected
  from public.follows f join public.profiles pr on pr.id=f.follower_id
  where f.following_id=p_user_id and f.status='accepted' and public.testagram_profile_is_visible_to_viewer(pr.id) and not public.testagram_accounts_blocked_between(pr.id)
  order by f.accepted_at desc nulls last,pr.username limit lim offset off
 ) x;
 return jsonb_build_object('items',v,'next_cursor',case when jsonb_array_length(v)=lim then (off+lim)::text else null end);
end $fn$;

create or replace function public.testagram_following_list(p_user_id uuid,p_limit int default 50,p_offset int default 0)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare u uuid:=auth.uid(); v jsonb; lim int:=greatest(1,least(coalesce(p_limit,50),50)); off int:=greatest(0,coalesce(p_offset,0));
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.testagram_profile_is_visible_to_viewer(p_user_id) then raise exception 'PROFILE_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v from (
  select pr.id,pr.username,pr.display_name,pr.avatar_url,pr.bio,(pr.verified_tier is not null and pr.verified_tier<>'none') verified,pr.follower_count followers_count,pr.following_count following_count,pr.protected_account is_protected
  from public.follows f join public.profiles pr on pr.id=f.following_id
  where f.follower_id=p_user_id and f.status='accepted' and public.testagram_profile_is_visible_to_viewer(pr.id) and not public.testagram_accounts_blocked_between(pr.id)
  order by f.accepted_at desc nulls last,pr.username limit lim offset off
 ) x;
 return jsonb_build_object('items',v,'next_cursor',case when jsonb_array_length(v)=lim then (off+lim)::text else null end);
end $fn$;

create or replace function public.testagram_mutuals_list(p_target_id uuid,p_limit int default 50,p_offset int default 0)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare u uuid:=auth.uid(); v jsonb; lim int:=greatest(1,least(coalesce(p_limit,50),50)); off int:=greatest(0,coalesce(p_offset,0));
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_target_id is null or not public.testagram_profile_is_visible_to_viewer(p_target_id) then raise exception 'PROFILE_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v from (
  select pr.id,pr.username,pr.display_name,pr.avatar_url,pr.bio,(pr.verified_tier is not null and pr.verified_tier<>'none') verified,pr.follower_count followers_count,pr.following_count following_count,pr.protected_account is_protected
  from public.follows a join public.follows b on b.following_id=a.following_id and b.follower_id=p_target_id and b.status='accepted'
  join public.profiles pr on pr.id=a.following_id
  where a.follower_id=u and a.status='accepted' and a.following_id<>p_target_id and public.testagram_profile_is_visible_to_viewer(pr.id) and not public.testagram_accounts_blocked_between(pr.id)
  order by pr.username limit lim offset off
 ) x;
 return jsonb_build_object('items',v,'next_cursor',case when jsonb_array_length(v)=lim then (off+lim)::text else null end);
end $fn$;

revoke all on function public.testagram_followers_list(uuid,int,int) from public;
revoke all on function public.testagram_following_list(uuid,int,int) from public;
revoke all on function public.testagram_mutuals_list(uuid,int,int);
grant execute on function public.testagram_followers_list(uuid,int,int) to authenticated;
grant execute on function public.testagram_following_list(uuid,int,int) to authenticated;
grant execute on function public.testagram_mutuals_list(uuid,int,int) to authenticated;

drop policy if exists list_members_select on public.list_members;
create policy list_members_select on public.list_members for select to authenticated using (
 exists(select 1 from public.lists l where l.id=list_members.list_id and (l.owner_id=auth.uid() or not l.is_private))
 and public.testagram_profile_is_visible_to_viewer(list_members.user_id)
 and not public.testagram_accounts_blocked_between(list_members.user_id)
);

do $body$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='generate_content_recommendations' limit 1;
 src:=replace(src,$old$select ub.blocked_id as user_id from public.user_blocks ub where ub.blocker_id = p_user_id$old$,$new$select ub.blocked_id as user_id from public.user_blocks ub where ub.blocker_id = p_user_id
    union select ub.blocker_id as user_id from public.user_blocks ub where ub.blocked_id = p_user_id$new$);
 execute src;
end $body$;

do $body$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' limit 1;
 src:=replace(src,$old$when 'testagram.follows.state' then
    select to_jsonb(public.get_follow_state((p_input->>'user_id')::uuid)) into v; return jsonb_build_object('state',v);$old$,
 $new$when 'testagram.follows.state' then
    select to_jsonb(public.get_follow_state((p_input->>'user_id')::uuid)) into v; return jsonb_build_object('state',v);
  when 'testagram.followers.list' then return public.testagram_followers_list((p_input->>'user_id')::uuid,v_limit,v_offset);
  when 'testagram.following.list' then return public.testagram_following_list((p_input->>'user_id')::uuid,v_limit,v_offset);
  when 'testagram.mutuals.list' then return public.testagram_mutuals_list((p_input->>'user_id')::uuid,v_limit,v_offset);$new$);
 execute src;
end $body$;

insert into public.capability_registry(name,version,access,readonly,description,enabled)
values ('testagram.followers.list',1,'authenticated',true,'List an authorized user follower projection.',true),
('testagram.following.list',1,'authenticated',true,'List an authorized user following projection.',true),
('testagram.mutuals.list',1,'authenticated',true,'List users followed by both the caller and target.',true)
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=excluded.enabled;