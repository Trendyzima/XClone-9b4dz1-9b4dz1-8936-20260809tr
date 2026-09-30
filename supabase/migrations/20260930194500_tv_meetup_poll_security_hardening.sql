drop policy if exists tv_live_polls_public_read on public.tv_live_polls;
create policy tv_live_polls_public_read on public.tv_live_polls
for select using (
  status = 'open'
  and (ends_at is null or now() < ends_at)
  and exists (
    select 1 from public.live_streams s
    where s.id = stream_id and s.is_live
  )
);

create or replace function public.tv_live_poll_results(p_poll_id uuid)
returns table(option_id text, vote_count bigint)
security definer
set search_path = public
language sql
stable
as $$
  select v.option_id, count(*)::bigint
  from public.tv_live_poll_votes v
  join public.tv_live_polls p on p.id = v.poll_id
  join public.live_streams s on s.id = p.stream_id
  where v.poll_id = p_poll_id
    and p.status = 'open'
    and s.is_live
    and (p.ends_at is null or now() < p.ends_at)
  group by v.option_id
  order by v.option_id
$$;

revoke all on function public.tv_live_poll_results(uuid) from public;
grant execute on function public.tv_live_poll_results(uuid) to authenticated;
