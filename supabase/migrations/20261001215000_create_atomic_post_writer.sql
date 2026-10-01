-- Canonical post writer used by testagram.posts.create.
-- SECURITY DEFINER is intentional: the capability dispatcher has already
-- authenticated the caller, and this function enforces auth.uid() ownership
-- while avoiding a second RLS evaluation inside the multi-table transaction.

create or replace function public.create_post_atomic(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_post_id uuid;
  v_poll_id uuid;
  v_question text;
  v_options text[];
  v_duration integer;
  v_ends_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  if nullif(trim(coalesce(p_input->>'content', p_input->>'body', '')),'') is null
     and jsonb_typeof(p_input->'poll') <> 'object'
     and nullif(p_input->>'image_url','') is null
     and nullif(p_input->>'video_url','') is null
     and coalesce(jsonb_array_length(p_input->'media_urls'),0)=0 then
    raise exception using errcode='22023', message='Post content is required';
  end if;

  insert into public.posts(
    user_id, author_id, content,
    media_url, media_type, media_urls, image_url, video_url,
    is_video, visibility, community_id,
    reply_to_post_id, quoted_post_id, quote_post_id, quote_of_post_id,
    media_count
  )
  values(
    v_user_id, v_user_id,
    coalesce(p_input->>'content', p_input->>'body', ''),
    nullif(p_input->>'media_url',''),
    nullif(p_input->>'media_type',''),
    case when jsonb_typeof(p_input->'media_urls')='array'
         then array(select jsonb_array_elements_text(p_input->'media_urls'))
         else '{}'::text[] end,
    nullif(p_input->>'image_url',''),
    nullif(p_input->>'video_url',''),
    coalesce((p_input->>'is_video')::boolean,false),
    coalesce(nullif(p_input->>'visibility',''),'public'),
    nullif(p_input->>'community_id','')::uuid,
    nullif(p_input->>'reply_to_post_id','')::uuid,
    nullif(p_input->>'quoted_post_id','')::uuid,
    nullif(p_input->>'quote_post_id','')::uuid,
    nullif(p_input->>'quote_of_post_id','')::uuid,
    coalesce((p_input->>'media_count')::integer,
             case when jsonb_typeof(p_input->'media_urls')='array'
                  then jsonb_array_length(p_input->'media_urls') else 0 end)
  )
  returning id into v_post_id;

  if jsonb_typeof(p_input->'poll')='object' then
    v_question := nullif(trim(p_input->'poll'->>'question'),'');
    if v_question is null or char_length(v_question) < 5 then
      raise exception using errcode='22023', message='Poll question is too short';
    end if;

    select coalesce(
      array_agg(trim(value) order by ordinality)
        filter (where char_length(trim(value)) > 0),
      '{}'::text[]
    )
    into v_options
    from jsonb_array_elements_text(
      coalesce(p_input->'poll'->'options','[]'::jsonb)
    ) with ordinality;

    if coalesce(array_length(v_options,1),0) < 2
       or coalesce(array_length(v_options,1),0) > 8 then
      raise exception using errcode='22023', message='A poll needs 2 to 8 answers';
    end if;

    v_duration := greatest(
      1,
      least(coalesce((p_input->'poll'->>'duration_minutes')::integer,1440),10080)
    );
    v_ends_at := now() + make_interval(mins => v_duration);

    insert into public.polls(
      post_id, creator_id, question, description,
      allow_multiple, visibility, ends_at
    )
    values(
      v_post_id, v_user_id, v_question, null,
      coalesce((p_input->'poll'->>'multiple_choice')::boolean,false),
      'public', v_ends_at
    )
    returning id into v_poll_id;

    insert into public.poll_options(poll_id,label,position)
    select v_poll_id, trim(value), (ordinality::integer - 1)::smallint
    from unnest(v_options) with ordinality as x(value, ordinality);
  end if;

  return jsonb_build_object(
    'post_id', v_post_id,
    'poll_id', v_poll_id,
    'created', true
  );
end;
$function$;

revoke all on function public.create_post_atomic(jsonb) from public;
grant execute on function public.create_post_atomic(jsonb) to authenticated;
