-- Make community polls first-class homepage posts.
-- The existing PostCard already renders polls by polls.post_id; this migration
-- completes that contract and makes poll publication atomic with post creation.

alter table public.polls
  add column if not exists post_id uuid references public.posts(id) on delete cascade;

create unique index if not exists polls_post_id_unique
  on public.polls(post_id)
  where post_id is not null;

create or replace function public.create_poll(
  p_question text,
  p_options text[],
  p_description text default null,
  p_ends_at timestamptz default null,
  p_allow_multiple boolean default false,
  p_visibility text default 'public'
) returns uuid
language plpgsql
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_poll uuid;
  v_post uuid;
  v_count integer := coalesce(array_length(p_options,1),0);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_question)) < 5 then raise exception 'Question is too short'; end if;
  if v_count < 2 or v_count > 8 then raise exception 'A poll needs 2 to 8 answers'; end if;
  if p_visibility not in ('public','followers') then raise exception 'Invalid visibility'; end if;
  if p_ends_at is not null and p_ends_at <= now() then raise exception 'End time must be in the future'; end if;

  insert into public.posts(user_id, author_id, content)
  values(v_uid, v_uid, trim(p_question))
  returning id into v_post;

  insert into public.polls(
    post_id, creator_id, question, description, allow_multiple, visibility, ends_at
  )
  values(
    v_post, v_uid, trim(p_question), nullif(trim(p_description), ''),
    p_allow_multiple, p_visibility, p_ends_at
  )
  returning id into v_poll;

  insert into public.poll_options(poll_id, label, position)
  select v_poll, trim(value), ordinality::smallint - 1
  from unnest(p_options) with ordinality
  where char_length(trim(value)) > 0;

  if (select count(*) from public.poll_options where poll_id = v_poll) < 2 then
    raise exception 'A poll needs at least 2 non-empty answers';
  end if;

  return v_poll;
end;
$function$;
