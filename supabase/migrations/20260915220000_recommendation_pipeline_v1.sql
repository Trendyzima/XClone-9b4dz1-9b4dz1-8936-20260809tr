create table if not exists public.content_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  recommended_post_id uuid not null,
  score numeric not null default 0,
  reason text not null default 'Recommended for you',
  source text not null default 'ranked',
  shown boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, recommended_post_id)
);

create index if not exists content_recommendations_user_score_idx on public.content_recommendations (user_id, shown, score desc, created_at desc);
create index if not exists content_recommendations_post_idx on public.content_recommendations (recommended_post_id);

alter table public.content_recommendations enable row level security;
drop policy if exists "recommendations_select_own" on public.content_recommendations;
create policy "recommendations_select_own" on public.content_recommendations for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "recommendations_update_own" on public.content_recommendations;
create policy "recommendations_update_own" on public.content_recommendations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.generate_content_recommendations(p_user_id uuid)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  if p_user_id is null or p_user_id <> auth.uid() then raise exception 'recommendation user mismatch'; end if;
  delete from public.content_recommendations where user_id = p_user_id and shown = false;
  with
  following as (select f.following_id as user_id from public.follows f where f.follower_id = p_user_id),
  blocked as (select ub.blocked_id as user_id from public.user_blocks ub where ub.blocker_id = p_user_id),
  seen as (
    select bh.post_id from public.browsing_history bh where bh.user_id = p_user_id and bh.post_id is not null and bh.created_at > now() - interval '14 days'
    union
    select l.post_id from public.likes l where l.user_id = p_user_id and l.created_at > now() - interval '30 days'
  ),
  interest_posts as (
    select ph.post_id, greatest(coalesce(max(ui.interest_score), 0), coalesce(max(ui.weight), 0)) as interest_score
    from public.post_hashtags ph join public.user_interests ui on ui.user_id = p_user_id and ui.hashtag_id = ph.hashtag_id
    group by ph.post_id
  ),
  second_degree as (
    select distinct f2.following_id as user_id from public.follows f1 join public.follows f2 on f2.follower_id = f1.following_id
    where f1.follower_id = p_user_id and f2.following_id <> p_user_id
  ),
  candidates as (
    select p.id, p.user_id, p.created_at, p.likes_count, p.reposts_count, p.replies_count, p.views_count, p.is_video, p.media_count,
      case when f.user_id is not null then 'following' when ip.post_id is not null then 'interest' when sd.user_id is not null then 'social' else 'trending' end as source,
      coalesce(ip.interest_score, 0) as interest_score,
      case when f.user_id is not null then 1 else 0 end as is_following,
      case when sd.user_id is not null then 1 else 0 end as is_second_degree
    from public.posts p left join following f on f.user_id = p.user_id left join interest_posts ip on ip.post_id = p.id left join second_degree sd on sd.user_id = p.user_id
    where p.deleted_at is null and p.community_id is null and p.visibility = 'public' and p.user_id <> p_user_id
      and not exists (select 1 from blocked b where b.user_id = p.user_id)
      and not exists (select 1 from seen s where s.post_id = p.id)
      and p.created_at > now() - interval '14 days'
  ),
  ranked as (
    select c.*, (8.0*c.is_following + least(18.0,c.interest_score*4.0) + 3.0*c.is_second_degree + 2.0*ln(1+greatest(c.likes_count,0)) + 3.0*ln(1+greatest(c.reposts_count,0)) + 1.5*ln(1+greatest(c.replies_count,0)) + 0.25*ln(1+greatest(c.views_count,0)) + case when c.is_video then 2.0 else 0 end + case when coalesce(c.media_count,0)>0 then 1.0 else 0 end) * exp(-extract(epoch from (now()-c.created_at))/86400.0/1.5) as score
    from candidates c
  ),
  diversified as (select r.*, row_number() over (partition by r.user_id order by r.score desc, r.created_at desc) as author_rank from ranked r)
  insert into public.content_recommendations (user_id, recommended_post_id, score, reason, source, shown)
  select p_user_id, d.id, d.score,
    case when d.is_following=1 then 'From someone you follow' when d.interest_score>0 then 'Matches your interests' when d.is_second_degree=1 then 'Popular with people in your network' else 'Trending now' end,
    d.source, false
  from diversified d where d.author_rank <= 3 order by d.score desc, d.created_at desc limit 30;

  insert into public.service_metrics(service, operation, status, duration_ms, metadata)
  values ('recommendations', 'generate_content_recommendations', 'ok', null,
          jsonb_build_object('user_id', p_user_id::text, 'generated_at', now()));
end;
$$;
revoke all on function public.generate_content_recommendations(uuid) from public;
grant execute on function public.generate_content_recommendations(uuid) to authenticated;
