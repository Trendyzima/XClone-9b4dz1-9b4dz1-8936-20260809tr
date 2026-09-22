-- Wisely surface open community polls without repeating polls a member has already answered.
-- Returns only public poll metadata and a relevance score; voter identities are never exposed.
create or replace function public.suggest_polls_for_user(
  p_limit integer default 3
)
returns table (
  poll_id uuid,
  post_id uuid,
  question text,
  description text,
  ends_at timestamptz,
  created_at timestamptz,
  community_id uuid,
  community_name text,
  community_display_name text,
  creator_id uuid,
  score numeric
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with candidates as (
    select
      p.id as poll_id,
      p.post_id,
      p.question,
      p.description,
      p.ends_at,
      p.created_at,
      po.community_id,
      c.name as community_name,
      c.display_name as community_display_name,
      p.creator_id,
      (
        case when cm.user_id is not null and cm.status = 'active' then 80 else 0 end
        + case when f.follower_id is not null then 45 else 0 end
        + least(30, greatest(0, 30 - extract(epoch from (now() - p.created_at))/86400))
        + least(20, greatest(0, coalesce((select sum(x.vote_count) from poll_options x where x.poll_id=p.id),0)))
        + case when p.ends_at is null then 0
               when p.ends_at > now() and p.ends_at <= now() + interval '48 hours' then 15
               else 0 end
      )::numeric as relevance_score
    from polls p
    join posts po on po.id = p.post_id
    left join communities c on c.id = po.community_id
    left join community_members cm
      on cm.community_id = po.community_id
     and cm.user_id = auth.uid()
    left join follows f
      on f.following_id = p.creator_id
     and f.follower_id = auth.uid()
    where p.visibility = 'public'
      and p.status = 'open'
      and (p.starts_at is null or p.starts_at <= now())
      and (p.ends_at is null or p.ends_at > now())
      and po.deleted_at is null
      and p.creator_id <> auth.uid()
      and not exists (
        select 1 from poll_votes pv
        where pv.poll_id = p.id
          and pv.voter_id = auth.uid()
      )
  )
  select
    poll_id, post_id, question, description, ends_at, created_at,
    community_id, community_name, community_display_name, creator_id,
    relevance_score as score
  from candidates
  order by relevance_score desc, created_at desc
  limit greatest(1, least(coalesce(p_limit,3), 10));
$function$;

revoke all on function public.suggest_polls_for_user(integer) from public, anon;
grant execute on function public.suggest_polls_for_user(integer) to authenticated;
