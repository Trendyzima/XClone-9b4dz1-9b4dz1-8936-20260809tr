-- X-style search/block boundary v13
do $$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' limit 1;

 if position('and (u is null or not public.testagram_accounts_blocked_between(u,id))' in src)=0 then
   src:=replace(
     src,
     'where discoverable_by_username=true and (username ilike ''%''||v_text||''%'' or display_name ilike ''%''||v_text||''%'' or bio ilike ''%''||v_text||''%'')',
     'where discoverable_by_username=true and (username ilike ''%''||v_text||''%'' or display_name ilike ''%''||v_text||''%'' or bio ilike ''%''||v_text||''%'') and (u is null or not public.testagram_accounts_blocked_between(u,id))'
   );
 end if;

 if position('not public.testagram_accounts_blocked_between(u,pr.id)' in src)=0 then
   src:=replace(
     src,
     'where public.testagram_post_is_visible_to_viewer(p.id,u) and pr.discoverable_by_username=true and (p.body ilike ''%''||v_text||''%'' or p.content ilike ''%''||v_text||''%'')',
     'where public.testagram_post_is_visible_to_viewer(p.id,u) and pr.discoverable_by_username=true and (u is null or not public.testagram_accounts_blocked_between(u,pr.id)) and (p.body ilike ''%''||v_text||''%'' or p.content ilike ''%''||v_text||''%'')'
   );
 end if;

 if position('not public.testagram_accounts_blocked_between(u,id)' in src)=0 then raise exception 'SEARCH_USERS_BLOCK_PATCH_FAILED'; end if;
 if position('not public.testagram_accounts_blocked_between(u,pr.id)' in src)=0 then raise exception 'SEARCH_POSTS_BLOCK_PATCH_FAILED'; end if;
 execute src;
end $$;
