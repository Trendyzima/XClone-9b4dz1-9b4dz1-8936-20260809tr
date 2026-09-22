-- Server-authoritative personalized home feed ranking.
create or replace function public.get_ranked_home_feed(
  p_user_id uuid,
  p_cursor_score double precision default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (post_id uuid, score double precision, reason text, source text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
with
following as (
  select f.following_id as user_id from public.follows f where f.follower_id = p_user_id
),
blocked as (
  select b.blocked_id as user_id from public.blocks b where b.blocker_id = p_user_id
),
muted as (
  select m.muted_id as user_id from public.mutes m where m.muter_id = p_user_id
),
seen as (
  select bh.entity_id as post_id from public.browsing_history bh
  where bh.user_id = p_user_id and bh.entity_type = 'post' and bh.entity_id is not null and bh.created_at > now() - interval '14 days'
  union
  select pr.post_id from public.post_reactions pr
  where pr.user_id = p_user_id and pr.created_at > now() - interval '30 days'
),
interest_posts as (
  select ph.post_id, max(coalesce(ui.interest_score, 0)) as interest_score
  from public.post_hashtags ph
  join public.user_interests ui on ui.user_id = p_user_id and ui.hashtag_id = ph.hashtag_id
  group by ph.post_id
),
second_degree as (
  select distinct f2.following_id as user_id
  from public.follows f1
  join public.follows f2 on f2.follower_id = f1.following_id
  where f1.follower_id = p_user_id and f2.following_id <> p_user_id
),
candidates as (
  select
    p.id, p.user_id, p.created_at, p.likes_count, p.reposts_count, p.replies_count, p.views_count,
    p.is_video, p.media_count, p.image_url, p.media_urls,
    case when f.user_id is not null then 'following'
         when ip.post_id is not null then 'interest'
         when sd.user_id is not null then 'social'
         else 'exploration' end as source,
    coalesce(ip.interest_score, 0) as interest_score,
    case when f.user_id is not null then 1 else 0 end as is_following,
    case when sd.user_id is not null then 1 else 0 end as is_second_degree
  from public.posts p
  left join following f on f.user_id = p.user_id
  left join interest_posts ip on ip.post_id = p.id
  left join second_degree sd on sd.user_id = p.user_id
  where p.deleted_at is null
    and p.community_id is null
    and p.user_id <> p_user_id
    and not exists (select 1 from blocked b where b.user_id = p.user_id)
    and not exists (select 1 from muted m where m.user_id = p.user_id)
    and not exists (select 1 from seen s where s.post_id = p.id)
    and p.created_at > now() - interval '14 days'
),
scored as (
  select
    c.*,
    (
      8.0 * c.is_following
      + least(18.0, c.interest_score * 4.0)
      + 3.0 * c.is_second_degree
      + 2.0 * ln(1 + greatest(coalesce(c.likes_count, 0), 0))
      + 3.0 * ln(1 + greatest(coalesce(c.reposts_count, 0), 0))
      + 1.5 * ln(1 + greatest(coalesce(c.replies_count, 0), 0))
      + 0.25 * ln(1 + greatest(coalesce(c.views_count, 0), 0))
      + case when coalesce(c.is_video, false) then 2.0 else 0 end
      + case when coalesce(c.media_count, 0) > 0 or c.image_url is not null or coalesce(array_length(c.media_urls, 1), 0) > 0 then 1.0 else 0 end
      + case when c.is_following = 0 and c.interest_score = 0 then 2.0 else 0 end
    ) * exp(-greatest(0, extract(epoch from (now() - c.created_at))) / 86400.0 / 1.5) as score
  from candidates c
),
diversified as (
  select s.*,
    row_number() over (partition by s.user_id order by s.score desc, s.created_at desc, s.id desc) as author_rank
  from scored s
),
ranked as (
  select * from diversified d
  where d.author_rank <= 3
    and (
      p_cursor_score is null
      or d.score < p_cursor_score
      or (d.score = p_cursor_score and d.created_at < p_cursor_created_at)
      or (d.score = p_cursor_score and d.created_at = p_cursor_created_at and d.id < p_cursor_id)
    )
)
select
  r.id as post_id,
  r.score,
  case
    when r.is_following = 1 then 'From someone you follow'
    when r.interest_score > 0 then 'Matches your interests'
    when r.is_second_degree = 1 then 'Popular with people in your network'
    when (coalesce(r.views_count, 0) + coalesce(r.likes_count, 0) * 4) >= 500 then 'Trending now'
    else 'Discovering something new'
  end as reason,
  r.source,
  r.created_at
from ranked r
order by r.score desc, r.created_at desc, r.id desc
limit greatest(1, least(p_limit, 50)) + 1;
$$;

revoke all on function public.get_ranked_home_feed(uuid, double precision, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_ranked_home_feed(uuid, double precision, timestamptz, uuid, integer) to service_role;
comment on function public.get_ranked_home_feed(uuid, double precision, timestamptz, uuid, integer)
is 'Server-authoritative personalized For You candidate generation, scoring, diversity and cursor pagination.';