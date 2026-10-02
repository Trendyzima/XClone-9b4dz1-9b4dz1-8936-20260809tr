-- 100k-capacity hardening: make high-frequency lookup/feed/delivery paths index-addressable.
-- Non-destructive: indexes/functions only; no rows, media, auth records, TV paths, or federation data are migrated.

create index if not exists conversations_participant_1_idx
  on public.conversations (participant_1);

create index if not exists conversations_participant_2_idx
  on public.conversations (participant_2);

-- Existing production posts_community_created_at_idx already covers community ordering.
-- Add the active author ordering path used by profile/following feeds.
create index if not exists posts_author_created_active_idx
  on public.posts (author_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists notification_delivery_outbox_pending_idx
  on public.notification_delivery_outbox (status, next_attempt_at, created_at)
  where status = 'pending';

create index if not exists notification_push_deliveries_token_idx
  on public.notification_push_deliveries (push_token_id, created_at desc);

create or replace function public.testagram_feed_v1(
  p_feed text default 'following',
  p_target_id uuid default null,
  p_limit integer default 20,
  p_cursor text default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_feed text := lower(btrim(coalesce(p_feed, 'following')));
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 20)));
  v_before timestamptz;
  v_before_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor text := null;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if v_feed not in ('following', 'global', 'profile', 'community') then
    raise exception using errcode = '22023', message = 'Unsupported feed';
  end if;

  if v_feed in ('profile', 'community') and p_target_id is null then
    raise exception using errcode = '22023', message = 'target_id is required';
  end if;

  if nullif(btrim(coalesce(p_cursor, '')), '') is not null then
    begin
      v_before := split_part(p_cursor, '|', 1)::timestamptz;
      v_before_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid feed cursor';
    end;
  end if;

  with page as (
    select
      p.id,
      p.user_id,
      p.author_id,
      p.content,
      p.image_url,
      p.video_url,
      p.is_video,
      p.media_urls,
      p.media_count,
      p.likes_count,
      p.reposts_count,
      p.replies_count,
      p.views_count,
      p.community_id,
      p.quoted_post_id,
      p.created_at,
      pr.id as profile_id,
      pr.username,
      pr.display_name,
      pr.avatar_url,
      pr.verified,
      row_number() over (order by p.created_at desc, p.id desc) as rn
    from public.posts p
    left join public.profiles pr
      on pr.id = coalesce(p.author_id, p.user_id)
    where p.deleted_at is null
      and (
        v_feed = 'global'
        or (v_feed = 'profile'
            and (
              p.author_id = p_target_id
              or (p.author_id is null and p.user_id = p_target_id)
            ))
        or (v_feed = 'community' and p.community_id = p_target_id)
        or (
          v_feed = 'following'
          and (
            p.author_id = v_user_id
            or (p.author_id is null and p.user_id = v_user_id)
            or exists (
              select 1
              from public.follows f
              where f.follower_id = v_user_id
                and f.following_id = coalesce(p.author_id, p.user_id)
                and f.status = 'accepted'
            )
          )
        )
      )
      and (
        v_before is null
        or p.created_at < v_before
        or (p.created_at = v_before and p.id < v_before_id)
      )
    order by p.created_at desc, p.id desc
    limit v_limit + 1
  ),
  trimmed as (
    select * from page where rn <= v_limit
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'post_id', t.id,
            'id', t.id,
            'user_id', t.user_id,
            'author_id', t.author_id,
            'content', t.content,
            'image_url', t.image_url,
            'video_url', t.video_url,
            'is_video', t.is_video,
            'media_urls', t.media_urls,
            'media_count', t.media_count,
            'likes_count', t.likes_count,
            'reposts_count', t.reposts_count,
            'replies_count', t.replies_count,
            'views_count', t.views_count,
            'community_id', t.community_id,
            'quoted_post_id', t.quoted_post_id,
            'created_at', t.created_at,
            'profile', jsonb_build_object(
              'id', t.profile_id,
              'username', t.username,
              'display_name', t.display_name,
              'avatar_url', t.avatar_url,
              'verified', t.verified
            )
          )
          order by t.created_at desc, t.id desc
        )
        from trimmed t
      ),
      '[]'::jsonb
    ),
    (
      select p.created_at::text || '|' || p.id::text
      from page p
      where p.rn = v_limit + 1
    )
  into v_items, v_next_cursor;

  return jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next_cursor
  );
end;
$function$;

create or replace function public.capability_dispatch(
  p_capability text,
  p_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_feed text := lower(coalesce(p_input->>'feed', 'following'));
begin
  p_capability := btrim(coalesce(p_capability, ''));

  if p_capability not in ('testagram.capabilities.list', 'testagram.health.read')
     and v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_capability = 'testagram.posts.list' then
    return public.testagram_feed_v1(
      case when v_feed in ('global', 'profile', 'community') then v_feed else 'following' end,
      nullif(p_input->>'target_id', '')::uuid,
      least(100, greatest(1, coalesce((p_input->>'limit')::integer, 20))),
      nullif(p_input->>'cursor', '')
    );
  end if;

  if p_capability = 'testagram.profile.timeline' then
    return public.testagram_feed_v1(
      'profile',
      nullif(p_input->>'user_id', '')::uuid,
      least(100, greatest(1, coalesce((p_input->>'limit')::integer, 20))),
      nullif(p_input->>'cursor', '')
    );
  end if;

  if p_capability = 'testagram.capabilities.list' then
    return jsonb_build_object(
      'capabilities',
      coalesce(
        (
          select jsonb_agg(to_jsonb(c) order by c.name)
          from public.capability_registry c
          where c.enabled = true
        ),
        '[]'::jsonb
      )
    );
  end if;

  if p_capability = 'testagram.health.read' then
    return jsonb_build_object(
      'services',
      jsonb_build_array(
        jsonb_build_object('service', 'database', 'status', 'ok'),
        jsonb_build_object('service', 'capability-gateway', 'status', 'ok')
      )
    );
  end if;

  return public.capability_dispatch_legacy(p_capability, p_input);
end;
$function$;

create or replace function public.capability_dispatch_v2(
  p_capability text,
  p_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
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

  if p_capability = 'testagram.posts.list' then
    return public.testagram_feed_v1(
      lower(coalesce(p_input->>'feed', 'following')),
      nullif(p_input->>'target_id', '')::uuid,
      least(100, greatest(1, coalesce((p_input->>'limit')::integer, 20))),
      nullif(p_input->>'cursor', '')
    );
  end if;

  if p_capability = 'testagram.profile.timeline' then
    return public.testagram_feed_v1(
      'profile',
      nullif(p_input->>'user_id', '')::uuid,
      least(100, greatest(1, coalesce((p_input->>'limit')::integer, 20))),
      nullif(p_input->>'cursor', '')
    );
  end if;

  if p_capability = 'testagram.posts.create' then
    return public.create_post_atomic_v3(p_input);
  end if;

  return public.capability_dispatch_legacy(p_capability, p_input);
end;
$function$;
