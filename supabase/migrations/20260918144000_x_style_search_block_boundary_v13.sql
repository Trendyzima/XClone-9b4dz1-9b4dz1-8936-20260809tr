-- X-style search/block boundary v13
do $$
declare src text; old text; new text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' limit 1;

 old := $old$
      select id,username,display_name,avatar_url,bio,
        (verified_tier is not null and verified_tier <> 'none') as verified,
        follower_count as followers_count,protected_account as is_protected
      from public.profiles
      where discoverable_by_username=true and (username ilike '%'||v_text||'%' or display_name ilike '%'||v_text||'%' or bio ilike '%'||v_text||'%')
      order by follower_count desc nulls last,username limit v_limit offset v_offset
$old$;
 new := $new$
      select id,username,display_name,avatar_url,bio,
        (verified_tier is not null and verified_tier <> 'none') as verified,
        follower_count as followers_count,protected_account as is_protected
      from public.profiles
      where discoverable_by_username=true
        and (username ilike '%'||v_text||'%' or display_name ilike '%'||v_text||'%' or bio ilike '%'||v_text||'%')
        and (u is null or not public.testagram_accounts_blocked_between(u,id))
      order by follower_count desc nulls last,username limit v_limit offset v_offset
$new$;
 if position(old in src)=0 then raise exception 'SEARCH_USERS_BLOCK_NOT_FOUND'; end if;
 src:=replace(src,old,new);

 old := $old2$
      where public.testagram_post_is_visible_to_viewer(p.id,u) and pr.discoverable_by_username=true and (p.body ilike '%'||v_text||'%' or p.content ilike '%'||v_text||'%')
$old2$;
 new := $new2$
      where public.testagram_post_is_visible_to_viewer(p.id,u)
        and pr.discoverable_by_username=true
        and (u is null or not public.testagram_accounts_blocked_between(u,pr.id))
        and (p.body ilike '%'||v_text||'%' or p.content ilike '%'||v_text||'%')
$new2$;
 if position(old in src)=0 then raise exception 'SEARCH_POSTS_BLOCK_NOT_FOUND'; end if;
 src:=replace(src,old,new);
 execute src;
end $$;
