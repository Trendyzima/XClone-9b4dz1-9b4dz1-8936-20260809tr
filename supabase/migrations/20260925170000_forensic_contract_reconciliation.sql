-- Forensic contract reconciliation: make analytics view recording idempotent for stale/deleted objects
-- and keep view RPCs callable only by authenticated clients.
create or replace function public.testagram_record_post_view(p_post_id uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_count bigint;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if not exists(select 1 from public.posts where id=p_post_id and deleted_at is null) then return 0; end if;
  insert into public.browsing_history(user_id,entity_type,entity_id,metadata)
  values(v_user,'post',p_post_id,jsonb_build_object('source','post_card'));
  update public.posts set views_count=coalesce(views_count,0)+1,updated_at=now() where id=p_post_id;
  insert into public.post_analytics(post_id,views,unique_viewers,updated_at) values(p_post_id,1,1,now())
  on conflict(post_id) do update set
    views=public.post_analytics.views+1,
    unique_viewers=(select count(distinct bh.user_id) from public.browsing_history bh where bh.entity_type='post' and bh.entity_id=p_post_id),
    updated_at=now();
  select views_count into v_count from public.posts where id=p_post_id;
  return coalesce(v_count,0);
end; $$;
revoke execute on function public.testagram_record_post_view(uuid) from anon;
grant execute on function public.testagram_record_post_view(uuid) to authenticated;
revoke execute on function public.testagram_record_federated_post_view(text) from anon;
grant execute on function public.testagram_record_federated_post_view(text) to authenticated;
