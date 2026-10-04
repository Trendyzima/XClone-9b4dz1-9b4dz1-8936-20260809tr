create or replace function public.save_user_interests(p_tags text[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tags text[];
  v_missing integer;
  v_saved integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(
    array_agg(distinct lower(trim(tag_value)) order by lower(trim(tag_value))),
    '{}'::text[]
  )
  into v_tags
  from unnest(coalesce(p_tags, '{}'::text[])) as input(tag_value)
  where nullif(trim(tag_value), '') is not null;

  if cardinality(v_tags) < 3 then
    raise exception 'Select at least 3 topics';
  end if;

  select count(*)
  into v_missing
  from unnest(v_tags) requested(tag)
  left join public.hashtags h on lower(h.tag) = requested.tag
  where h.id is null;

  if v_missing > 0 then
    raise exception 'One or more selected topics are not available';
  end if;

  delete from public.user_interests
  where user_id = v_user_id;

  insert into public.user_interests(user_id, hashtag_id, interest_score)
  select v_user_id, h.id, 1.0
  from public.hashtags h
  where lower(h.tag) = any(v_tags);

  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

revoke all on function public.save_user_interests(text[]) from public;
grant execute on function public.save_user_interests(text[]) to authenticated;
