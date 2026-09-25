create or replace function public.testagram_record_post_share(p_post_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_shares bigint;
begin
  if p_post_id is null then
    raise exception 'post_id is required';
  end if;

  insert into public.post_analytics (post_id, views, unique_viewers, engagement_rate, shares)
  values (p_post_id, 0, 0, 0, 1)
  on conflict (post_id) do update
    set shares = coalesce(public.post_analytics.shares, 0) + 1,
        updated_at = now()
  returning shares into next_shares;

  return coalesce(next_shares, 0);
end;
$$;

revoke all on function public.testagram_record_post_share(uuid) from public;
grant execute on function public.testagram_record_post_share(uuid) to service_role;
