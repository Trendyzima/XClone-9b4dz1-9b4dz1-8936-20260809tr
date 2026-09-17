-- Deletion propagation v18: clear stale hashtag recency and unshown recommendations.

create or replace function public.sync_post_hashtags()
returns trigger
language plpgsql
set search_path=public
as $fn$
declare
  source_text text;
  m text[];
  tag_value text;
  hid uuid;
  affected_ids uuid[] := '{}'::uuid[];
begin
  if tg_op <> 'INSERT' then
    affected_ids := coalesce(
      (select array_agg(ph.hashtag_id) from public.post_hashtags ph where ph.post_id=old.id),
      '{}'::uuid[]
    );
    delete from public.post_hashtags where post_id=old.id;
    delete from public.content_recommendations
      where recommended_post_id=old.id and shown=false;
  end if;

  if tg_op <> 'DELETE' then
    source_text:=coalesce(to_jsonb(new)->>'body','')||' '||coalesce(to_jsonb(new)->>'content','');
    for m in select regexp_matches(source_text,'#([[:alnum:]_]{1,64})','g') loop
      tag_value:=lower(m[1]);
      if tag_value='' then continue; end if;
      insert into public.hashtags(tag,last_used_at)
      values(tag_value,now())
      on conflict(tag) do update set last_used_at=excluded.last_used_at
      returning id into hid;
      if hid is null then
        select id into hid from public.hashtags where tag=tag_value;
      end if;
      insert into public.post_hashtags(post_id,hashtag_id,created_at)
      values(new.id,hid,now()) on conflict do nothing;
      affected_ids:=array_append(affected_ids,hid);
    end loop;
  end if;

  if cardinality(affected_ids)>0 then
    update public.hashtags h
       set post_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0),
           usage_count=coalesce((select count(*) from public.post_hashtags ph where ph.hashtag_id=h.id),0),
           follower_count=coalesce((select count(*) from public.hashtag_follows hf where hf.hashtag_id=h.id),0),
           last_used_at=(select max(ph.created_at) from public.post_hashtags ph where ph.hashtag_id=h.id)
     where h.id=any(affected_ids);
  end if;
  return coalesce(new,old);
end;
$fn$;

revoke all on function public.sync_post_hashtags() from public;

drop trigger if exists posts_sync_hashtags on public.posts;
create trigger posts_sync_hashtags
after insert or delete or update on public.posts
for each row execute function public.sync_post_hashtags();

drop trigger if exists trg_sync_post_hashtags on public.posts;
create trigger trg_sync_post_hashtags
after insert or update of content on public.posts
for each row execute function public.sync_post_hashtags();

create or replace function public.suppress_deleted_post_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path=public
as $fn$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.notification_delivery_outbox
    where status in ('pending','failed')
      and notification_id in (
        select n.id from public.notifications n where n.post_id = new.id
      );
    delete from public.content_recommendations
      where recommended_post_id = new.id and shown=false;
  end if;
  return new;
end;
$fn$;

revoke all on function public.suppress_deleted_post_notification_delivery() from public;
