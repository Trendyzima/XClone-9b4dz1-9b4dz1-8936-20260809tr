-- Repair the federated hashtag retrieval contract used by HashtagPage.
create or replace function public.get_federated_posts_for_hashtag_json(
  p_hashtag_id uuid,
  p_limit integer default 30
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.published_at desc nulls last, x.id desc), '[]'::jsonb)
  from (
    select f.id,f.uri,f.actor_uri,f.content,f.summary,f.published_at,f.updated_at,
           f.attachments,f.tags,f.like_count,f.announce_count,f.reply_count,
           f.object_type,f.url
    from public.federated_hashtag_mentions m
    join public.federated_objects f on f.id=m.object_id
    where m.hashtag_id=p_hashtag_id
      and f.deleted_at is null
      and f.tombstone=false
    order by f.published_at desc nulls last,f.id desc
    limit least(greatest(coalesce(p_limit,30),1),100)
  ) x
$$;

revoke all on function public.get_federated_posts_for_hashtag_json(uuid,integer) from public,anon;
grant execute on function public.get_federated_posts_for_hashtag_json(uuid,integer) to anon,authenticated;

create index if not exists hashtags_trending_recency_idx
  on public.hashtags(last_used_at desc,federated_post_count desc,post_count desc);
