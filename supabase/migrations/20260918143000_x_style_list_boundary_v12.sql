-- X-style list boundary hardening v12

drop policy if exists list_members_insert on public.list_members;
create policy list_members_insert on public.list_members for insert to authenticated
with check (
  exists (select 1 from public.lists l where l.id=list_members.list_id and l.owner_id=auth.uid())
  and not public.testagram_accounts_blocked_between(auth.uid(),list_members.user_id)
);

drop policy if exists list_members_write on public.list_members;
create policy list_members_write on public.list_members for all to authenticated
using (exists (select 1 from public.lists l where l.id=list_members.list_id and l.owner_id=auth.uid()))
with check (
  exists (select 1 from public.lists l where l.id=list_members.list_id and l.owner_id=auth.uid())
  and not public.testagram_accounts_blocked_between(auth.uid(),list_members.user_id)
);

create or replace function public.get_list_timeline(p_list_id uuid,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql set search_path=public as $function$
declare u uuid:=auth.uid(); v jsonb; v_limit int:=greatest(1,least(coalesce(p_limit,20),50)); v_offset int:=greatest(0,coalesce(p_offset,0));
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if not exists (select 1 from public.lists l where l.id=p_list_id and (l.owner_id=u or not l.is_private or exists(select 1 from public.list_members lm where lm.list_id=l.id and lm.user_id=u))) then raise exception 'LIST_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v from (
   select p.id,p.author_id,p.user_id,p.body,p.content,p.created_at,p.updated_at,p.media_url,p.media_type,p.media_count,p.community_id,pr.username,pr.display_name,pr.avatar_url
   from public.posts p
   join public.list_members lm on lm.list_id=p_list_id and lm.user_id=p.author_id
   join public.profiles pr on pr.id=p.author_id
   where p.deleted_at is null
     and public.testagram_post_is_visible_to_viewer(p.id,u)
     and not public.testagram_accounts_blocked_between(u,p.author_id)
   order by p.created_at desc limit v_limit offset v_offset
 ) x;
 return v;
end;
$function$;
