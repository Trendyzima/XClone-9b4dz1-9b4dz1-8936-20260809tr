-- Allow community polls to carry one canonical R2 media asset on their homepage post.
-- The upload itself stays on the existing authenticated /api/media -> R2 pipeline.

drop function if exists public.create_poll(text,text[],text,timestamp with time zone,boolean,text);

create or replace function public.create_poll(
  p_question text,
  p_options text[],
  p_description text default null,
  p_ends_at timestamp with time zone default null,
  p_allow_multiple boolean default false,
  p_visibility text default 'public',
  p_media_asset_id uuid default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_poll uuid;
  v_post uuid;
  v_media public.media_assets%rowtype;
  v_count integer := coalesce(array_length(p_options,1),0);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_question)) < 5 then raise exception 'Question is too short'; end if;
  if v_count < 2 or v_count > 8 then raise exception 'A poll needs 2 to 8 answers'; end if;
  if p_visibility not in ('public','followers') then raise exception 'Invalid visibility'; end if;
  if p_ends_at is not null and p_ends_at <= now() then raise exception 'End time must be in the future'; end if;

  if p_media_asset_id is not null then
    select * into v_media
    from public.media_assets
    where id = p_media_asset_id and owner_id = v_uid and status = 'ready'
    for update;
    if not found then raise exception 'Selected media is unavailable or not owned by you'; end if;
    if v_media.media_type not in ('image','video') then raise exception 'Poll media must be an image or video'; end if;
  end if;

  insert into public.posts(user_id, author_id, content, image_url, video_url, is_video, media_urls, media_count)
  values(
    v_uid, v_uid, trim(p_question),
    case when p_media_asset_id is not null and v_media.media_type = 'image' then v_media.media_url else null end,
    case when p_media_asset_id is not null and v_media.media_type = 'video' then v_media.media_url else null end,
    case when p_media_asset_id is not null then v_media.media_type = 'video' else false end,
    case when p_media_asset_id is not null and v_media.media_url is not null then array[v_media.media_url]::text[] else '{}'::text[] end,
    case when p_media_asset_id is not null and v_media.media_url is not null then 1 else 0 end
  )
  returning id into v_post;

  if p_media_asset_id is not null then
    update public.media_assets set post_id = v_post, updated_at = now() where id = p_media_asset_id;
    insert into public.post_media(post_id, owner_id, media_url, media_type, mime_type, byte_size, media_asset_id, sort_order)
    values(v_post, v_uid, v_media.media_url, v_media.media_type, v_media.mime_type, v_media.byte_size, v_media.id, 0);
  end if;

  insert into public.polls(post_id, creator_id, question, description, allow_multiple, visibility, ends_at)
  values(v_post, v_uid, trim(p_question), nullif(trim(p_description),''), p_allow_multiple, p_visibility, p_ends_at)
  returning id into v_poll;

  insert into public.poll_options(poll_id,label,position)
  select v_poll, trim(value), ordinality::smallint-1
  from unnest(p_options) with ordinality
  where char_length(trim(value)) > 0;

  if (select count(*) from public.poll_options where poll_id=v_poll) < 2 then
    raise exception 'A poll needs at least 2 non-empty answers';
  end if;
  return v_poll;
end;
$function$;

grant execute on function public.create_poll(text,text[],text,timestamp with time zone,boolean,text,uuid) to authenticated;
