create or replace function public.create_post_atomic_v3(p_input jsonb)
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
  v_community_id uuid := nullif(p_input->>'community_id','')::uuid;
begin
  if v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  if nullif(trim(coalesce(p_input->>'content',p_input->>'body','')),'') is null
     and jsonb_typeof(p_input->'poll') <> 'object'
     and nullif(p_input->>'image_url','') is null
     and nullif(p_input->>'video_url','') is null
     and coalesce(jsonb_array_length(p_input->'media_urls'),0)=0 then
    raise exception using errcode='22023', message='Post content is required';
  end if;

  if v_community_id is not null and not exists (
    select 1 from public.communities c
    where c.id=v_community_id
      and (
        c.visibility='public'
        or c.owner_id=v_user_id
        or exists (
          select 1 from public.community_members m
          where m.community_id=c.id
            and m.user_id=v_user_id
            and m.status='active'
        )
      )
  ) then
    raise exception using errcode='42501', message='You are not allowed to post in this community';
  end if;

  insert into public.posts(
    user_id, author_id, content, image_url, video_url, is_video,
    community_id, media_urls, media_count, quoted_post_id
  )
  values(
    v_user_id, v_user_id,
    coalesce(p_input->>'content',p_input->>'body',''),
    nullif(p_input->>'image_url',''),
    nullif(p_input->>'video_url',''),
    coalesce((p_input->>'is_video')::boolean,false),
    v_community_id,
    case
      when jsonb_typeof(p_input->'media_urls')='array'
      then array(select jsonb_array_elements_text(p_input->'media_urls'))
      else '{}'::text[]
    end,
    coalesce(
      (p_input->>'media_count')::integer,
      case
        when jsonb_typeof(p_input->'media_urls')='array'
        then jsonb_array_length(p_input->'media_urls')
        else 0
      end
    ),
    nullif(coalesce(p_input->>'quoted_post_id',p_input->>'quote_post_id'),'')::uuid
  )
  returning id into v_post_id;

  if jsonb_typeof(p_input->'poll')='object' then
    v_question := nullif(trim(p_input->'poll'->>'question'),'');
    if v_question is null or char_length(v_question)<5 then
      raise exception using errcode='22023', message='Poll question is too short';
    end if;

    select coalesce(
      array_agg(trim(value) order by ordinality) filter(where char_length(trim(value))>0),
      '{}'::text[]
    )
    into v_options
    from jsonb_array_elements_text(coalesce(p_input->'poll'->'options','[]'::jsonb))
      with ordinality;

    if coalesce(array_length(v_options,1),0)<2 or coalesce(array_length(v_options,1),0)>8 then
      raise exception using errcode='22023', message='A poll needs 2 to 8 answers';
    end if;

    v_duration := greatest(1,least(coalesce((p_input->'poll'->>'duration_minutes')::integer,1440),10080));
    v_ends_at := now()+make_interval(mins=>v_duration);

    insert into public.polls(
      post_id, creator_id, question, description, allow_multiple, visibility, ends_at
    )
    values(
      v_post_id, v_user_id, v_question, null,
      coalesce((p_input->'poll'->>'multiple_choice')::boolean,false),
      'public', v_ends_at
    )
    returning id into v_poll_id;

    insert into public.poll_options(poll_id,label,position)
    select v_poll_id,trim(value),(ordinality::integer-1)::smallint
    from unnest(v_options) with ordinality as x(value,ordinality);
  end if;

  return jsonb_build_object('post_id',v_post_id,'poll_id',v_poll_id,'created',true);
end;
$function$;

revoke all on function public.create_post_atomic_v3(jsonb) from public;
grant execute on function public.create_post_atomic_v3(jsonb) to authenticated;

create or replace function public.capability_dispatch_v2(
  p_capability text,
  p_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  p_capability := btrim(coalesce(p_capability,''));

  if p_capability not in ('testagram.capabilities.list','testagram.health.read')
     and v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  case p_capability
    when 'testagram.posts.create' then
      return public.create_post_atomic_v3(p_input);
    else
      return public.capability_dispatch_legacy(p_capability,p_input);
  end case;
end;
$function$;

revoke all on function public.capability_dispatch_v2(text,jsonb) from public;
grant execute on function public.capability_dispatch_v2(text,jsonb) to anon, authenticated;
