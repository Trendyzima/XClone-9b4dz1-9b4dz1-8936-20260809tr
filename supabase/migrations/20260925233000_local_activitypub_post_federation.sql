-- Outbound ActivityPub publication for local Testagram posts.
-- Emit Create/Update/Delete activities for remote followers and expose
-- standalone public posts to federated instances through the actor outbox.

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
      or new.visibility is distinct from old.visibility
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

    if new.reply_to_post_id is not null then
      v_object := v_object || jsonb_build_object(
        'inReplyTo',
        format('https://testagram.site/users/%s/statuses/%s', v_username, new.reply_to_post_id)
      );
    end if;
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

revoke all on function public.enqueue_local_post_federation() from public, anon, authenticated;

drop trigger if exists trg_enqueue_local_post_federation on public.posts;
create trigger trg_enqueue_local_post_federation
after insert or delete or update of content, image_url, video_url, media_urls, visibility, edited_at, deleted_at
on public.posts
for each row
execute function public.enqueue_local_post_federation();

-- Backfill the currently existing public Testagram posts into the outbox so
-- content already published locally becomes discoverable remotely.
insert into public.federated_activities(
  uri, activity_type, actor_uri, object_uri, raw_activity, processing_state, processing_attempts
)
select
  format('https://testagram.site/users/%s/statuses/%s/activity', aa.username, p.id),
  'Create',
  aa.actor_id,
  format('https://testagram.site/users/%s/statuses/%s', aa.username, p.id),
  jsonb_build_object(
    '@context','https://www.w3.org/ns/activitystreams',
    'id',format('https://testagram.site/users/%s/statuses/%s/activity',aa.username,p.id),
    'type','Create','actor',aa.actor_id,'published',p.created_at,
    'to',jsonb_build_array('https://www.w3.org/ns/activitystreams#Public'),
    'cc',jsonb_build_array(aa.actor_id||'/followers'),
    'object',jsonb_build_object(
      '@context','https://www.w3.org/ns/activitystreams',
      'id',format('https://testagram.site/users/%s/statuses/%s',aa.username,p.id),
      'type','Note','attributedTo',aa.actor_id,'content',coalesce(p.content,''),
      'published',p.created_at,'updated',coalesce(p.edited_at,p.updated_at,p.created_at),
      'url',format('https://testagram.site/users/%s/statuses/%s',aa.username,p.id),
      'to',jsonb_build_array('https://www.w3.org/ns/activitystreams#Public'),
      'cc',jsonb_build_array(aa.actor_id||'/followers')
    )
  ),
  'pending',0
from public.posts p
join public.activitypub_actors aa on aa.user_id=p.author_id
where p.deleted_at is null
  and p.visibility='public'
on conflict (uri) do nothing;

insert into public.activitypub_outbox(
  local_user_id,activity_type,activity_id,payload,delivered,attempts,next_attempt_at,expires_at
)
select fa_local.user_id, fa.activity_type, fa.uri, fa.raw_activity, false, 0, now(), now()+interval '14 days'
from public.federated_activities fa
join public.activitypub_actors fa_local on fa_local.actor_id=fa.actor_uri
where fa.actor_uri like 'https://testagram.site/%'
  and fa.activity_type='Create'
  and fa.processing_state='pending'
  and not exists (
    select 1 from public.activitypub_outbox ao where ao.activity_id=fa.uri
  );

insert into public.federation_deliveries(
  activity_id,target_inbox,instance_domain,status,attempt_count,next_attempt_at,activity_payload
)
select fa.id,f.remote_inbox_uri,lower(split_part(regexp_replace(f.remote_inbox_uri,'^https?://',''), '/', 1)),
       'pending',0,now(),fa.raw_activity
from public.federated_activities fa
join public.activitypub_actors aa on aa.actor_id=fa.actor_uri
join public.federated_follow_relationships f
  on f.local_user_id=aa.user_id
 and f.direction='follower'
 and f.state in ('accepted','active')
 and f.delivery_state in ('delivered','queued','pending')
 and f.remote_inbox_uri is not null
where fa.actor_uri like 'https://testagram.site/%'
  and fa.activity_type='Create'
  and fa.processing_state='pending'
on conflict (activity_id,target_inbox) do nothing;
