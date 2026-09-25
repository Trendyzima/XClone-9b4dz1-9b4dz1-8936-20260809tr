-- Keep the federated content cache bounded: imported objects expire five hours
-- after ingestion, while actor metadata remains available for future imports.

create index if not exists federated_objects_created_at_idx
  on public.federated_objects (created_at);

create index if not exists federated_hashtag_mentions_object_id_idx
  on public.federated_hashtag_mentions (object_id);

create or replace function public.cleanup_expired_fediverse_content(
  p_retention interval default interval '5 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_object_ids uuid[];
  v_hashtag_ids uuid[];
  v_mentions_deleted integer := 0;
  v_objects_deleted integer := 0;
begin
  if p_retention < interval '1 hour' then
    raise exception 'Fediverse retention must be at least 1 hour';
  end if;

  v_cutoff := now() - p_retention;

  select coalesce(array_agg(id), '{}'::uuid[])
    into v_object_ids
  from public.federated_objects
  where created_at < v_cutoff;

  if cardinality(v_object_ids) = 0 then
    return jsonb_build_object(
      'ok', true,
      'retention_hours', extract(epoch from p_retention) / 3600,
      'cutoff', v_cutoff,
      'mentions_deleted', 0,
      'objects_deleted', 0
    );
  end if;

  select coalesce(array_agg(distinct hashtag_id), '{}'::uuid[])
    into v_hashtag_ids
  from public.federated_hashtag_mentions
  where object_id = any(v_object_ids);

  delete from public.federated_hashtag_mentions
  where object_id = any(v_object_ids);
  get diagnostics v_mentions_deleted = row_count;

  delete from public.federated_objects
  where id = any(v_object_ids);
  get diagnostics v_objects_deleted = row_count;

  if cardinality(v_hashtag_ids) > 0 then
    update public.hashtags h
       set federated_post_count = (
         select count(*)
         from public.federated_hashtag_mentions m
         where m.hashtag_id = h.id
       )
     where h.id = any(v_hashtag_ids);
  end if;

  return jsonb_build_object(
    'ok', true,
    'retention_hours', extract(epoch from p_retention) / 3600,
    'cutoff', v_cutoff,
    'mentions_deleted', v_mentions_deleted,
    'objects_deleted', v_objects_deleted
  );
end;
$$;

revoke all on function public.cleanup_expired_fediverse_content(interval) from public;
revoke all on function public.cleanup_expired_fediverse_content(interval) from anon, authenticated;

do $do$
begin
  if exists(select 1 from cron.job where jobname='fediverse-content-retention') then
    perform cron.unschedule('fediverse-content-retention');
  end if;

  perform cron.schedule(
    'fediverse-content-retention',
    '*/30 * * * *',
    $job$select public.cleanup_expired_fediverse_content(interval '5 hours');$job$
  );
end $do$;
