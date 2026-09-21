-- Federated bookmarks use ActivityPub object URIs instead of local post UUIDs.
create table if not exists public.federated_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_uri text not null,
  created_at timestamptz not null default now(),
  unique(user_id, object_uri)
);
alter table public.federated_bookmarks enable row level security;
drop policy if exists federated_bookmarks_owner on public.federated_bookmarks;
create policy federated_bookmarks_owner on public.federated_bookmarks
  for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,delete on public.federated_bookmarks to authenticated;

create or replace function public.testagram_federated_bookmark_add(p_object_uri text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if btrim(coalesce(p_object_uri,'')) !~ '^https://[^[:space:]]+$' then raise exception using errcode='22023',message='Valid remote object URI is required'; end if;
  insert into public.federated_bookmarks(user_id,object_uri) values(v_user,btrim(p_object_uri))
    on conflict(user_id,object_uri) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.federated_bookmarks where user_id=v_user and object_uri=btrim(p_object_uri); end if;
  return jsonb_build_object('bookmark_id',v_id,'object_uri',btrim(p_object_uri),'saved',true);
end $$;

create or replace function public.testagram_federated_bookmark_remove(p_object_uri text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user uuid := auth.uid(); v_deleted integer;
begin
  if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
  delete from public.federated_bookmarks where user_id=v_user and object_uri=btrim(p_object_uri);
  get diagnostics v_deleted=row_count;
  return jsonb_build_object('object_uri',btrim(p_object_uri),'removed',v_deleted>0);
end $$;

create or replace function public.testagram_federated_bookmark_list(p_limit integer default 100)
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb))
  from (select id,object_uri,created_at from public.federated_bookmarks where user_id=auth.uid() order by created_at desc limit least(greatest(coalesce(p_limit,100),1),100)) x;
$$;
grant execute on function public.testagram_federated_bookmark_add(text),public.testagram_federated_bookmark_remove(text),public.testagram_federated_bookmark_list(integer) to authenticated;