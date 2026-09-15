-- X-style feature/ranking upgrade inspired by the public Community Notes architecture:
-- multi-signal ranking, uncertainty/context, source diversity, negative feedback, and notification relevance.

create table if not exists public.creator_quality_signals (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  engagement_quality numeric(10,5) not null default 0,
  consistency_score numeric(10,5) not null default 0,
  context_quality numeric(10,5) not null default 0,
  sample_size integer not null default 0,
  computed_at timestamptz not null default now()
);

alter table public.creator_quality_signals enable row level security;
drop policy if exists creator_quality_signals_public_read on public.creator_quality_signals;
create policy creator_quality_signals_public_read on public.creator_quality_signals for select to authenticated using (true);
create index if not exists creator_quality_signals_quality_idx on public.creator_quality_signals (engagement_quality desc, context_quality desc);

create or replace function public.refresh_creator_quality_signal(p_user_id uuid)
returns void language plpgsql security invoker set search_path = public
as $$
declare
  v_impressions numeric := 0; v_engagements numeric := 0; v_posts numeric := 0;
  v_context numeric := 0; v_quality numeric := 0; v_consistency numeric := 0;
begin
  if p_user_id is null then raise exception 'creator user required'; end if;
  select count(*)::numeric into v_posts from public.posts p
   where p.user_id=p_user_id and p.deleted_at is null and p.created_at > now()-interval '30 days';
  select coalesce(sum(coalesce(pe.dwell_ms,0)),0)::numeric, count(*)::numeric
    into v_engagements,v_impressions from public.content_events pe join public.posts p on p.id=pe.post_id
   where p.user_id=p_user_id and pe.created_at > now()-interval '30 days'
     and pe.event_type in ('like','reply','repost','share','save','open');
  select coalesce(avg(cn.helpful_score),0)::numeric into v_context from public.community_notes cn
   join public.posts p on p.id=cn.post_id where p.user_id=p_user_id and cn.status='published'
   and cn.created_at > now()-interval '90 days';
  v_quality := least(1,(v_engagements/greatest(v_impressions,1))/20.0);
  v_consistency := least(1,v_posts/30.0);
  insert into public.creator_quality_signals(user_id,engagement_quality,consistency_score,context_quality,sample_size,computed_at)
  values(p_user_id,v_quality,v_consistency,least(1,v_context),greatest(v_impressions::integer,0),now())
  on conflict(user_id) do update set engagement_quality=excluded.engagement_quality,
    consistency_score=excluded.consistency_score,context_quality=excluded.context_quality,
    sample_size=excluded.sample_size,computed_at=excluded.computed_at;
end; $$;
revoke all on function public.refresh_creator_quality_signal(uuid) from public,anon;
grant execute on function public.refresh_creator_quality_signal(uuid) to authenticated;

create or replace function public.generate_content_recommendations(p_user_id uuid)
returns void language plpgsql security invoker set search_path=public
as $$
begin
  if p_user_id is null or p_user_id <> auth.uid() then raise exception 'recommendation user mismatch'; end if;
  perform public.refresh_creator_quality_signal(p_user_id);
  delete from public.content_recommendations where user_id=p_user_id and shown=false;
  with following as (select following_id as user_id from public.follows where follower_id=p_user_id and status='accepted'),
  blocked as (select blocked_id as user_id from public.user_blocks where blocker_id=p_user_id union select muted_id from public.mutes where muter_id=p_user_id),
  seen as (select post_id from public.content_events where user_id=p_user_id and post_id is not null and created_at>now()-interval '14 days' and event_type in ('impression','open','hide','not_interested') union select post_id from public.browsing_history where user_id=p_user_id and post_id is not null and created_at>now()-interval '14 days' union select post_id from public.post_likes where user_id=p_user_id and created_at>now()-interval '30 days'),
  negative as (select post_id from public.content_events where user_id=p_user_id and post_id is not null and created_at>now()-interval '30 days' and event_type in ('hide','not_interested')),
  interests as (select hashtag_id,greatest(coalesce(interest_score,0),coalesce(weight,0)) weight from public.user_interests where user_id=p_user_id),
  interest_posts as (select ph.post_id,max(i.weight) interest_weight from public.post_hashtags ph join interests i on i.hashtag_id=ph.hashtag_id group by ph.post_id),
  second_degree as (select distinct f2.following_id user_id from public.follows f1 join public.follows f2 on f2.follower_id=f1.following_id where f1.follower_id=p_user_id and f2.following_id<>p_user_id and f2.status='accepted'),
  list_membership as (select lm.user_id from public.list_members lm join public.lists l on l.id=lm.list_id where l.owner_id=p_user_id),
  candidates as (
    select p.id,p.user_id,p.created_at,p.likes_count,p.reposts_count,p.replies_count,p.views_count,p.is_video,p.media_count,
      case when f.user_id is not null then 'following' when ip.post_id is not null then 'interest' when lm.user_id is not null then 'list' when sd.user_id is not null then 'social' else 'trending' end source,
      coalesce(ip.interest_weight,0) interest_weight,case when f.user_id is not null then 1 else 0 end following_signal,
      case when sd.user_id is not null then 1 else 0 end social_signal,case when lm.user_id is not null then 1 else 0 end list_signal,
      coalesce(cq.engagement_quality,0) creator_quality,coalesce(cq.consistency_score,0) creator_consistency,
      coalesce(cn.helpful_score,0) context_score,coalesce(cn.rating_count,0) context_ratings,coalesce(cn.perspective_count,0) context_perspectives
    from public.posts p left join following f on f.user_id=p.user_id left join interest_posts ip on ip.post_id=p.id
    left join second_degree sd on sd.user_id=p.user_id left join list_membership lm on lm.user_id=p.user_id
    left join public.creator_quality_signals cq on cq.user_id=p.user_id
    left join lateral (select helpful_score,rating_count,perspective_count from public.community_notes where post_id=p.id and status='published' order by helpful_score desc,rating_count desc limit 1) cn on true
    where p.deleted_at is null and p.community_id is null and p.visibility='public' and p.user_id<>p_user_id
      and not exists(select 1 from blocked b where b.user_id=p.user_id) and not exists(select 1 from seen s where s.post_id=p.id)
      and not exists(select 1 from negative n where n.post_id=p.id) and p.created_at>now()-interval '14 days'
  ),
  scored as (select c.*,(10*c.following_signal+6*c.list_signal+4*c.social_signal+least(20,c.interest_weight*4)+3.5*c.creator_quality+1.5*c.creator_consistency+case when c.context_score>=.70 and c.context_ratings>=5 and c.context_perspectives>=2 then 2.5 else 0 end+2*ln(1+greatest(c.likes_count,0))+3*ln(1+greatest(c.reposts_count,0))+2*ln(1+greatest(c.replies_count,0))+.15*ln(1+greatest(c.views_count,0))+case when c.is_video then 2 else 0 end+case when coalesce(c.media_count,0)>0 then 1 else 0 end)*exp(-extract(epoch from(now()-c.created_at))/86400/1.5) raw_score from candidates c),
  diversified as (select s.*,row_number() over(partition by s.user_id order by s.raw_score desc,s.created_at desc) author_rank from scored s),
  source_limited as (select d.*,row_number() over(partition by d.source order by d.raw_score desc,d.created_at desc) source_rank from diversified d where d.author_rank<=3)
  insert into public.content_recommendations(user_id,recommended_post_id,score,reason,source,shown)
  select p_user_id,x.id,x.raw_score,case when x.context_score>=.70 and x.context_ratings>=5 and x.context_perspectives>=2 then 'Community context available' when x.following_signal=1 then 'From someone you follow' when x.list_signal=1 then 'From a list you follow' when x.interest_weight>0 then 'Matches your interests' when x.social_signal=1 then 'Popular with people in your network' else 'Trending now' end,x.source,false
  from source_limited x where x.source_rank<=15 order by x.raw_score desc,x.created_at desc limit 40;
  insert into public.service_metrics(service,operation,status,duration_ms,metadata) values('recommendations','generate_content_recommendations','ok',null,jsonb_build_object('user_id',p_user_id::text,'algorithm','x_style_multisignal_v2','generated_at',now()));
end; $$;
revoke all on function public.generate_content_recommendations(uuid) from public,anon;
grant execute on function public.generate_content_recommendations(uuid) to authenticated;

create or replace function public.rank_notifications(p_user_id uuid,p_limit integer default 50)
returns table(id uuid,score numeric) language sql security invoker set search_path=public as $$
  with base as (select n.id,(case n.kind when 'mention' then 10 when 'reply' then 9 when 'follow' then 7 when 'repost' then 6 when 'like' then 4 else 2 end+case when n.read_at is null then 3 else 0 end+case when n.priority='urgent' then 8 when n.priority='high' then 5 when n.priority='normal' then 2 else 0 end+case when exists(select 1 from public.follows f where f.follower_id=p_user_id and f.following_id=n.actor_id and f.status='accepted') then 4 else 0 end+case when n.created_at>now()-interval '1 hour' then 5 when n.created_at>now()-interval '6 hours' then 3 when n.created_at>now()-interval '24 hours' then 1 else 0 end)::numeric score from public.notifications n where n.recipient_id=p_user_id and n.archived_at is null and (n.expires_at is null or n.expires_at>now()) and not exists(select 1 from public.notification_preferences np where np.user_id=p_user_id and np.notif_type=n.kind and np.in_app=false))
  select id,score from base order by score desc,id limit greatest(1,least(p_limit,100));
$$;
revoke all on function public.rank_notifications(uuid,integer) from public,anon;
grant execute on function public.rank_notifications(uuid,integer) to authenticated;
