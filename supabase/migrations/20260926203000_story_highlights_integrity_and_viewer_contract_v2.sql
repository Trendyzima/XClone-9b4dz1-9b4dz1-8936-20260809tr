-- Harden story highlight integrity and make highlighted stories viewable after story expiry.
create or replace function public.validate_user_highlight_story_ids()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  requested_count integer;
  owned_count integer;
begin
  if new.story_ids is null or cardinality(new.story_ids) < 1 then
    raise exception 'A highlight must contain at least one story';
  end if;

  select count(*) into requested_count
  from (
    select distinct unnest(new.story_ids) as story_id
  ) s;

  select count(*) into owned_count
  from public.stories s
  where s.id = any(new.story_ids)
    and s.owner_id = new.user_id
    and s.deleted_at is null;

  if owned_count <> requested_count then
    raise exception 'Highlight contains a story that does not belong to this user or is deleted';
  end if;

  return new;
end;
$$;

drop trigger if exists user_highlights_validate_story_ids on public.user_highlights;
create trigger user_highlights_validate_story_ids
before insert or update of user_id, story_ids on public.user_highlights
for each row execute function public.validate_user_highlight_story_ids();

drop policy if exists stories_active_public on public.stories;
create policy stories_active_public on public.stories
for select to authenticated
using (
  deleted_at is null
  and (
    owner_id = (select auth.uid())
    or (expires_at > now() and visibility = 'public')
    or exists (
      select 1
      from public.user_highlights h
      where h.user_id = stories.owner_id
        and h.story_ids @> array[stories.id]::uuid[]
    )
  )
);
