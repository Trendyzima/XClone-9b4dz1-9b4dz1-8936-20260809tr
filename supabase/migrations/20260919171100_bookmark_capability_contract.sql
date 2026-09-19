-- Bookmark backend contract.
create unique index if not exists bookmarks_user_post_unique
  on public.bookmarks(user_id,post_id);
create index if not exists bookmarks_user_created_idx
  on public.bookmarks(user_id,created_at desc);

create or replace function public.testagram_bookmark_add(p_post_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to public
as $$
declare v_user uuid := (select auth.uid()); v_id uuid;
begin
  if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
  insert into public.bookmarks(user_id,post_id) values(v_user,p_post_id)
  on conflict (user_id,post_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.bookmarks where user_id=v_user and post_id=p_post_id;
  end if;
  return jsonb_build_object('bookmark_id',v_id,'post_id',p_post_id,'saved',true);
end $$;

create or replace function public.testagram_bookmark_remove(p_post_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to public
as $$
declare v_user uuid := (select auth.uid()); v_deleted integer;
begin
  if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
  delete from public.bookmarks where user_id=v_user and post_id=p_post_id;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('post_id',p_post_id,'removed',v_deleted>0);
end $$;

insert into public.capability_registry(name,version,access,readonly,enabled,description)
values
 ('testagram.bookmarks.add',1,'authenticated',false,true,'Save a post for the authenticated user.'),
 ('testagram.bookmarks.remove',1,'authenticated',false,true,'Remove a saved post for the authenticated user.')
on conflict (name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,enabled=excluded.enabled,description=excluded.description,updated_at=now();
