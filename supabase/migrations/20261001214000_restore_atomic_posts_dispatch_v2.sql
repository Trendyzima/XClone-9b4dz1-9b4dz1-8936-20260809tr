create or replace function public.create_post_atomic(p_input jsonb)
returns jsonb language plpgsql security invoker set search_path to 'public' as $function$
declare
  u uuid := auth.uid();
  post_id uuid;
  poll_id uuid;
  poll jsonb;
  option_value text;
  expires_at timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(trim(coalesce(p_input->>'content', p_input->>'body', '')), '') is null
     and coalesce(jsonb_array_length(coalesce(p_input->'media_urls','[]'::jsonb)),0)=0
     and nullif(p_input->>'image_url','') is null
     and nullif(p_input->>'video_url','') is null then
    raise exception 'POST_CONTENT_REQUIRED';
  end if;

  insert into public.posts(
    user_id, author_id, content, media_urls, image_url, video_url, is_video,
    community_id, quoted_post_id, media_count
  )
  values(
    u, u, coalesce(p_input->>'content',p_input->>'body',''),
    coalesce(p_input->'media_urls','[]'::jsonb),
    nullif(p_input->>'image_url',''),
    nullif(p_input->>'video_url',''),
    coalesce((p_input->>'is_video')::boolean,false),
    nullif(p_input->>'community_id','')::uuid,
    nullif(p_input->>'quoted_post_id','')::uuid,
    coalesce((p_input->>'media_count')::int,0)
  )
  returning id into post_id;

  poll := p_input->'poll';
  if jsonb_typeof(poll)='object' then
    expires_at := case
      when nullif(poll->>'expires_at','') is not null then (poll->>'expires_at')::timestamptz
      when nullif(poll->>'duration_minutes','') is not null then now()+((poll->>'duration_minutes')::int*interval '1 minute')
      else null
    end;

    insert into public.polls(post_id,question,expires_at,multiple_choice)
    values(post_id,coalesce(nullif(trim(poll->>'question'),''),'Poll'),expires_at,coalesce((poll->>'multiple_choice')::boolean,false))
    returning id into poll_id;

    for option_value in select value from jsonb_array_elements_text(coalesce(poll->'options','[]'::jsonb)) loop
      if nullif(trim(option_value),'') is not null then
        insert into public.poll_options(poll_id,label,sort_order)
        values(poll_id,trim(option_value),(select count(*)::smallint from public.poll_options where poll_id=poll_id));
      end if;
    end loop;
  end if;

  return jsonb_build_object('post_id',post_id,'poll_id',poll_id,'created',true);
end;
$function$;

revoke all on function public.create_post_atomic(jsonb) from public;
grant execute on function public.create_post_atomic(jsonb) to authenticated;

create or replace function public.capability_dispatch(
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
  p_capability := btrim(coalesce(p_capability, ''));

  if p_capability not in ('testagram.capabilities.list', 'testagram.health.read')
     and v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  case p_capability
    when 'testagram.posts.create' then
      return public.create_post_atomic(p_input);
    else
      return public.capability_dispatch_legacy(p_capability, p_input);
  end case;
end;
$function$;

revoke all on function public.capability_dispatch(text,jsonb) from public;
grant execute on function public.capability_dispatch(text,jsonb) to anon, authenticated;

insert into public.capability_registry(
  name, version, access, readonly, enabled, description
)
values (
  'testagram.posts.create',
  2,
  'authenticated',
  false,
  true,
  'Create a native Testagram post, including polls, atomically.'
)
on conflict (name) do update set
  version = excluded.version,
  access = excluded.access,
  readonly = excluded.readonly,
  enabled = true,
  description = excluded.description,
  updated_at = now();
