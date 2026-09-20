-- Harden poll voting and public vote totals without exposing voter rows.
create schema if not exists private;

alter table public.poll_options
  add column if not exists vote_count bigint not null default 0;

create or replace function private.sync_poll_option_vote_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.poll_options
      set vote_count = vote_count + 1
      where id = new.option_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.poll_options
      set vote_count = greatest(0, vote_count - 1)
      where id = old.option_id;
    return old;
  end if;
  return null;
end;
$$;

revoke all on function private.sync_poll_option_vote_count() from public;
revoke all on schema private from public;
grant usage on schema private to postgres;

drop trigger if exists poll_vote_counter_insert on public.poll_votes;
drop trigger if exists poll_vote_counter_delete on public.poll_votes;
create trigger poll_vote_counter_insert
after insert on public.poll_votes
for each row execute function private.sync_poll_option_vote_count();
create trigger poll_vote_counter_delete
after delete on public.poll_votes
for each row execute function private.sync_poll_option_vote_count();

create policy "poll_votes_own_insert"
on public.poll_votes
for insert
to authenticated
with check (voter_id = (select auth.uid()));

create or replace function public.poll_results(p_poll_id uuid)
returns jsonb
language sql
set search_path = public
as $function$
  select jsonb_build_object(
    'poll_id', p.id,
    'question', p.question,
    'description', p.description,
    'status', case when p.ends_at is not null and p.ends_at <= now() and p.status='open' then 'closed' else p.status end,
    'ends_at', p.ends_at,
    'total_votes', coalesce((select sum(o.vote_count) from public.poll_options o where o.poll_id=p.id),0),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,'label',o.label,'position',o.position,'votes',o.vote_count
      ) order by o.position)
      from public.poll_options o where o.poll_id=p.id
    ),'[]'::jsonb)
  )
  from public.polls p where p.id=p_poll_id;
$function$;

grant execute on function public.poll_results(uuid) to anon, authenticated;
grant execute on function public.cast_poll_vote(uuid,uuid[]) to authenticated;

-- Deployment reconciliation marker: poll feed contract is complete.
