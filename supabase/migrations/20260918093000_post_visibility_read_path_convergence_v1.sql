-- Canonical post visibility read-path convergence.
-- Prevent legacy SECURITY DEFINER/read helpers from bypassing the canonical
-- testagram_post_is_visible_to_viewer() decision boundary.

create or replace function public.get_public_profile(p_username text)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'verified_tier', p.verified_tier,
    'follower_count', p.follower_count,
    'following_count', p.following_count,
    'protected_account', p.protected_account,
    'created_at', p.created_at,
    'post_count', (
      select count(*)
      from public.posts x
      where x.author_id = p.id
        and public.testagram_post_is_visible_to_viewer(x.id, auth.uid())
    ),
    'like_count', (
      select count(*)
      from public.post_likes l
      join public.posts x on x.id = l.post_id
      where x.author_id = p.id
        and public.testagram_post_is_visible_to_viewer(x.id, auth.uid())
    ),
    'is_following', exists(
      select 1
      from public.follows f
      where f.follower_id = auth.uid()
        and f.following_id = p.id
        and f.status = 'accepted'
    )
  )
  from public.profiles p
  where lower(p.username) = lower(p_username)
  limit 1;
$function$;

create or replace function public.get_unified_feed(
  p_limit integer default 30,
  p_offset integer default 0,
  p_mode text default 'for_you'
)
returns table(
  source text,
  object_key text,
  author_id uuid,
  author_uri text,
  author_username text,
  author_display_name text,
  author_avatar_url text,
  body text,
  media_url text,
  media_type text,
  created_at timestamptz,
  like_count bigint,
  reply_count bigint,
  repost_count bigint,
  score numeric
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
with
params as (
  select least(greatest(coalesce(p_limit,30),1),50)::int lim,
         greatest(coalesce(p_offset,0),0)::int off,
         coalesce(nullif(p_mode,''),'for_you') mode
),
local_base as (
  select 'local'::text source,
         ('local:'||p.id::text) object_key,
         p.author_id,
         null::text author_uri,
         pf.username author_username,
         pf.display_name author_display_name,
         pf.avatar_url author_avatar_url,
         p.body,
         p.media_url,
         p.media_type,
         p.created_at,
         p.like_count::bigint like_count,
         p.reply_count::bigint reply_count,
         p.repost_count::bigint repost_count,
         (
           greatest(0,1.0-extract(epoch from(now()-p.created_at))/172800.0)*3.0
           + ln(1+p.like_count)*1.15
           + ln(1+p.reply_count)*1.45
           + ln(1+p.repost_count)*1.9
           + case when exists(
               select 1 from public.follows f
               where f.follower_id=auth.uid()
                 and f.following_id=p.author_id
                 and f.status='accepted'
             ) then 5 else 0 end
           + case when exists(
               select 1 from public.content_events e
               where e.user_id=auth.uid()
                 and e.post_id=p.id
                 and e.event_type in('open','like','reply','repost','save')
             ) then 4 else 0 end
           - case when exists(
               select 1 from public.content_events e
               where e.user_id=auth.uid()
                 and e.post_id=p.id
                 and e.event_type in('hide','not_interested')
             ) then 15 else 0 end
           + case when p.created_at>now()-interval '15 minutes' then 2.5 else 0 end
         ) score
  from public.posts p
  join public.profiles pf on pf.id=p.author_id
  where public.testagram_post_is_visible_to_viewer(p.id, auth.uid())
),
remote_base as (
  select 'federated'::text source,
         ('remote:'||fo.uri) object_key,
         null::uuid author_id,
         fo.actor_uri author_uri,
         coalesce(fa.preferred_username,'remote') author_username,
         coalesce(fa.display_name,fa.preferred_username,'Federated user') author_display_name,
         fa.avatar_url author_avatar_url,
         fo.content body,
         coalesce(fo.attachments->0->>'url',fo.url) media_url,
         case when lower(coalesce(fo.attachments->0->>'type',''))='video' then 'video'
              when lower(coalesce(fo.attachments->0->>'type',''))='image' then 'image'
              else null end media_type,
         coalesce(fo.published_at,fo.created_at) created_at,
         (
           (select count(*) from public.federated_object_reactions r
            where r.object_uri=fo.uri and r.reaction_type='like' and r.active)
           +(select count(*) from public.federated_activities a
             where a.object_uri=fo.uri and a.activity_type='Like')
         )::bigint like_count,
         (select count(*) from public.federated_activities a
          where a.object_uri=fo.uri and a.activity_type in('Create','Reply'))::bigint reply_count,
         (
           (select count(*) from public.federated_object_reactions r
            where r.object_uri=fo.uri and r.reaction_type='repost' and r.active)
           +(select count(*) from public.federated_activities a
             where a.object_uri=fo.uri and a.activity_type='Announce')
         )::bigint repost_count,
         (
           greatest(0,1.0-extract(epoch from(now()-coalesce(fo.published_at,fo.created_at)))/259200.0)*2.8
           + ln(1+(select count(*) from public.federated_activities a where a.object_uri=fo.uri and a.activity_type='Like'))*1.1
           + ln(1+(select count(*) from public.federated_activities a where a.object_uri=fo.uri and a.activity_type='Announce'))*1.8
           + ln(1+(select count(*) from public.federated_activities a where a.object_uri=fo.uri and a.activity_type in('Create','Reply')))*1.25
           + case when exists(
               select 1 from public.federated_follow_requests fr
               where fr.local_user_id=auth.uid()
                 and fr.remote_actor_uri=fo.actor_uri
                 and fr.state in('active','accepted')
             ) then 5 else 0 end
           + case when exists(
               select 1 from public.federated_feed_events e
               where e.user_id=auth.uid()
                 and e.object_uri=fo.uri
                 and e.event_type in('open','like','reply','repost','save')
             ) then 4 else 0 end
           - case when exists(
               select 1 from public.federated_feed_events e
               where e.user_id=auth.uid()
                 and e.object_uri=fo.uri
                 and e.event_type in('hide','not_interested')
             ) then 15 else 0 end
           + case when coalesce(fo.published_at,fo.created_at)>now()-interval '30 minutes' then 2 else 0 end
         ) score
  from public.federated_objects fo
  left join public.federated_actors fa on fa.uri=fo.actor_uri
  where not fo.sensitive
    and fo.object_type in('Note','Article','Image','Video','Page','Question','Event')
),
candidates as (
  select * from local_base
  where (select mode from params)<>'following'
     or exists(
       select 1 from public.follows f
       where f.follower_id=auth.uid()
         and f.following_id=local_base.author_id
         and f.status='accepted'
     )
  union all
  select * from remote_base
  where (select mode from params)<>'following'
     or exists(
       select 1 from public.federated_follow_requests fr
       where fr.local_user_id=auth.uid()
         and fr.remote_actor_uri=remote_base.author_uri
         and fr.state in('active','accepted')
     )
),
filtered as (
  select c.*,
         row_number() over(
           partition by coalesce(c.author_id::text,c.author_uri)
           order by c.score desc,c.created_at desc
         ) author_rank,
         row_number() over(
           partition by coalesce(split_part(c.author_uri,'/',3),'local')
           order by c.score desc,c.created_at desc
         ) domain_rank
  from candidates c
),
diverse as (
  select * from filtered where author_rank<=3 and domain_rank<=6
),
explore as (
  select d.*,d.score+(random()*0.35) exploration_score from diverse d
)
select source,object_key,author_id,author_uri,author_username,
       author_display_name,author_avatar_url,body,media_url,media_type,
       created_at,like_count,reply_count,repost_count,exploration_score score
from explore
order by score desc,created_at desc
limit(select lim from params)
offset(select off from params);
$function$;

create or replace function public.record_post_view(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.testagram_post_is_visible_to_viewer(p_post_id, auth.uid()) then
    raise exception 'post not found';
  end if;

  insert into public.post_views(post_id, viewer_id, last_viewed_at, view_count)
  values (p_post_id, auth.uid(), now(), 1)
  on conflict (post_id, viewer_id) do update
    set last_viewed_at = excluded.last_viewed_at,
        view_count = public.post_views.view_count + 1;
end;
$function$;
