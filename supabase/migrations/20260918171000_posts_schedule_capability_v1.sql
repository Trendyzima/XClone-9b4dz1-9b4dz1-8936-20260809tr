-- Canonical scheduled post capability v1.
create or replace function public.schedule_post_atomic(p_input jsonb)
returns jsonb language plpgsql security invoker set search_path to 'public' as $function$
declare u uuid:=auth.uid(); v_id uuid; v_when timestamptz:=nullif(p_input->>'scheduled_for','')::timestamptz;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if v_when is null or v_when<=now() then raise exception 'INVALID_SCHEDULE_TIME'; end if;
 if nullif(trim(coalesce(p_input->>'body',p_input->>'content','')),'') is null then raise exception 'POST_CONTENT_REQUIRED'; end if;
 insert into public.scheduled_posts(author_id,body,scheduled_for,status) values(u,coalesce(p_input->>'body',p_input->>'content',''),v_when,'scheduled') returning id into v_id;
 return jsonb_build_object('scheduled_post_id',v_id,'scheduled',true);
end;$function$;
revoke all on function public.schedule_post_atomic(jsonb) from public;
grant execute on function public.schedule_post_atomic(jsonb) to authenticated;
do $body$ declare src text; old text; new text; begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' limit 1;
 if src is null then raise exception 'CAPABILITY_DISPATCH_NOT_FOUND'; end if;
 old:=$old$ when 'testagram.posts.create' then
   return public.create_post_atomic(p_input);
$old$;
 new:=$new$ when 'testagram.posts.create' then
   return public.create_post_atomic(p_input);
 when 'testagram.posts.schedule' then
   return public.schedule_post_atomic(p_input);
$new$;
 if position(old in src)=0 then raise exception 'POSTS_CREATE_DISPATCH_BRANCH_NOT_FOUND'; end if;
 execute replace(src,old,new);
end $body$;
insert into public.capability_registry(name,version,access,readonly,description,enabled) values('testagram.posts.schedule',1,'authenticated',false,'Schedule a native Testagram text post through the canonical scheduled-post boundary.',true) on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,description=excluded.description,enabled=true,updated_at=now();
