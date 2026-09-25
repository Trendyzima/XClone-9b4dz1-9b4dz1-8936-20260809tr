-- Align local ActivityPub publisher with the live posts schema.
create or replace function public.enqueue_local_post_federation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_actor_id text;
  v_username text;
  v_object_uri text;
  v_activity_id text;
  v_payload jsonb;
  v_activity_row_id uuid;
  v_inbox text;
  v_remote_actor text;
  v_media jsonb := '[]'::jsonb;
  v_to jsonb;
  v_cc jsonb;
  v_type text;
  v_object jsonb;
begin
  v_user_id := coalesce(new.author_id, old.author_id);

  select aa.actor_id, aa.username
    into v_actor_id, v_username
  from public.activitypub_actors aa
  where aa.user_id = v_user_id
  limit 1;

  -- Users without an ActivityPub actor/key are not federated yet.
  -- The keygen flow provisions these actors; do not block normal posting.
  if v_actor_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_type := 'Create';
  elsif tg_op = 'DELETE' then
    v_type := 'Delete';
  else
    -- Only publish meaningful post changes. Likes/reposts/views are tracked
    -- separately and must not create an ActivityPub Update for every counter.
    if not (
      new.content is distinct from old.content
      or new.image_url is distinct from old.image_url
      or new.video_url is distinct from old.video_url
      or new.media_urls is distinct from old.media_urls
     
      or new.edited_at is distinct from old.edited_at
      or new.deleted_at is distinct from old.deleted_at
    ) then
      return new;
    end if;
    v_type := case when new.deleted_at is not null and old.deleted_at is null then 'Delete' else 'Update' end;
  end if;

  v_object_uri := format('https://testagram.site/users/%s/statuses/%s', v_username, coalesce(new.id, old.id));

  if v_type = 'Delete' then
    v_object := jsonb_build_object('id', v_object_uri, 'type', 'Tombstone');
    v_payload := jsonb_build_object(
      '@context', 'https://www.w3.org/ns/activitystreams',
      'id', v_object_uri || '/activity',
      'type', 'Delete',
      'actor', v_actor_id,
      'object', v_object
    );
  else
    if coalesce(array_length(new.media_urls,1),0) > 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
        'type', case when coalesce(new.is_video,false) then 'Video' else 'Image' end,
        'mediaType', case when coalesce(new.is_video,false) then 'video/mp4' else 'image/*' end,
        'url', x
      )), '[]'::jsonb)
      into v_media
      from unnest(new.media_urls) x;
    elsif new.video_url is not null then
      v_media := jsonb_build_array(jsonb_build_object('type','Video','mediaType','video/mp4','url',new.video_url));
    elsif new.image_url is not null then
      v_media := jsonb_build_array(jsonb_build_object('type','Image','mediaType','image/*','url',new.image_url));
    end if;

    v_object := jsonb_build_object(
      '@context', 'https://www.w3.org/ns/activitystreams',
      'id', v_object_uri,
      'type', 'Note',
      'attributedTo', v_actor_id,
      'content', coalesce(new.content,''),
      'published', coalesce(new.created_at, now()),
      'updated', coalesce(new.edited_at, new.updated_at, new.created_at, now()),
      'url', v_object_uri,
      'to', jsonb_build_array('https://www.w3.org/ns/activitystreams#Public'),
      'cc', jsonb_build_array(v_actor_id || '/followers')
    );

    if jsonb_array_length(v_media) > 0 then
      v_object := v_object || jsonb_build_object('attachment', v_media);
    end if;

    v_payload := jsonb_build_object(
      '@context', 'https://www.w3.org/ns/activitystreams',
      'id', v_object_uri || '/activity',
      'type', v_type,
      'actor', v_actor_id,
      'published', coalesce(new.created_at, now()),
      'to', jsonb_build_array('https://www.w3.org/ns/activitystreams#Public'),
      'cc', jsonb_build_array(v_actor_id || '/followers'),
      'object', v_object
    );
  end if;

  v_activity_id := v_payload->>'id';

  insert into public.federated_activities(
    uri, activity_type, actor_uri, object_uri, raw_activity,
    processing_state, processing_attempts
  ) values (
    v_activity_id, v_type, v_actor_id,
    v_object_uri, v_payload, 'pending', 0
  )
  on conflict (uri) do update set
    raw_activity = excluded.raw_activity,
    activity_type = excluded.activity_type,
    object_uri = excluded.object_uri,
    updated_at = now()
  returning id into v_activity_row_id;

  insert into public.activitypub_outbox(
    local_user_id, activity_type, activity_id, payload,
    delivered, attempts, next_attempt_at, expires_at
  ) values (
    v_user_id, v_type, v_activity_id, v_payload,
    false, 0, now(), now() + interval '14 days'
  )
  on conflict do nothing;

  -- Deliver public activities to every active remote follower. The delivery
  -- worker signs each POST with this local actor's ActivityPub key.
  for v_remote_actor, v_inbox in
    select f.remote_actor_uri, f.remote_inbox_uri
    from public.federated_follow_relationships f
    where f.local_user_id = v_user_id
      and f.direction = 'follower'
      and f.state in ('accepted','active')
      and f.delivery_state in ('delivered','queued','pending')
      and f.remote_inbox_uri is not null
  loop
    insert into public.federation_deliveries(
      activity_id, target_inbox, instance_domain, status,
      attempt_count, next_attempt_at, activity_payload
    ) values (
      v_activity_row_id, v_inbox, lower(split_part(regexp_replace(v_inbox,'^https?://',''), '/', 1)),
      'pending', 0, now(), v_payload
    )
    on conflict (activity_id, target_inbox) do nothing;
  end loop;

  return coalesce(new, old);
end;
$$;
;
