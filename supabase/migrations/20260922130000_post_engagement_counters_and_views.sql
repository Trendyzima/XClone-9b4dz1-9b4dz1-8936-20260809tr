create table if not exists public.federated_post_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_uri text not null,
  viewed_at timestamptz not null default now()
);
create index if not exists federated_post_views_object_idx on public.federated_post_views(object_uri, viewed_at desc);
create index if not exists federated_post_views_user_object_idx on public.federated_post_views(user_id, object_uri, viewed_at desc);
alter table public.federated_post_views enable row level security;
drop policy if exists federated_post_views_owner on public.federated_post_views;
create policy federated_post_views_owner on public.federated_post_views for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create or replace function public.testagram_record_post_view(p_post_id uuid)
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_user uuid := (select auth.uid()); v_count bigint;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.posts where id=p_post_id and deleted_at is null) then raise exception 'post not found'; end if;
  insert into public.browsing_history(user_id,entity_type,entity_id,metadata)
  values(v_user,'post',p_post_id,jsonb_build_object('source','post_card'));
  update public.posts set views_count=coalesce(views_count,0)+1,updated_at=now() where id=p_post_id;
  insert into public.post_analytics(post_id,views,unique_viewers,updated_at)
  values(p_post_id,1,1,now())
  on conflict (post_id) do update set
    views=public.post_analytics.views+1,
    unique_viewers=(select count(distinct bh.user_id) from public.browsing_history bh where bh.entity_type='post' and bh.entity_id=p_post_id),
    updated_at=now();
  select views_count into v_count from public.posts where id=p_post_id;
  return v_count;
end; $$;
revoke execute on function public.testagram_record_post_view(uuid) from public;
grant execute on function public.testagram_record_post_view(uuid) to authenticated;

create or replace function public.testagram_record_federated_post_view(p_object_uri text)
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_user uuid := (select auth.uid()); v_count bigint;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_object_uri is null or p_object_uri !~* '^https://' then raise exception 'invalid object uri'; end if;
  if not exists (select 1 from public.federated_post_views where user_id=v_user and object_uri=p_object_uri and viewed_at>now()-interval '5 minutes') then
    insert into public.federated_post_views(user_id,object_uri) values(v_user,p_object_uri);
  end if;
  select count(*) into v_count from public.federated_post_views where object_uri=p_object_uri;
  return v_count;
end; $$;
revoke execute on function public.testagram_record_federated_post_view(text) from public;
grant execute on function public.testagram_record_federated_post_view(text) to authenticated;

create unique index if not exists post_analytics_post_id_uidx on public.post_analytics(post_id);