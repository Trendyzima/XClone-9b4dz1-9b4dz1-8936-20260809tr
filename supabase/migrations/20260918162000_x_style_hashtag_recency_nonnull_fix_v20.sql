-- v20: hashtags.last_used_at is NOT NULL; use epoch sentinel when no indexed posts remain.

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

  if tg_op <> 'DELETE' and new.deleted_at is null then
    source_text:=coalesce(to_jsonb(new)->>'body','')||' '||coalesce(to_jsonb(new)->>'content','');
    for m in select regexp_matches(source_text,'#([[:alnum:]_]{1,64})','g') loop
      tag_value:=lower(m[1]);
      if tag_value='' then continue; end if;
      insert into public.hashtags(tag,last_used_at)
      values(tag_value,now())
      on conflict(tag) do update set last_used_at=excluded.last_used_at
      returning id into hid;
      if hid is null then select id into hid from public.hashtags where tag=tag_value; end if;
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
           last_used_at=coalesce(
             (select max(ph.created_at) from public.post_hashtags ph where ph.hashtag_id=h.id),
             'epoch'::timestamptz
           )
     where h.id=any(affected_ids);
  end if;
  return coalesce(new,old);
end;
$fn$;

revoke all on function public.sync_post_hashtags() from public;
