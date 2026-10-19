-- Keep the five-hour Fediverse cache retention contract without allowing one
-- cleanup invocation to monopolize database connections or hold a large array of
-- every expired object ID in memory. Each run removes a bounded oldest-first batch.
CREATE OR REPLACE FUNCTION public.cleanup_expired_fediverse_content(
  p_retention interval DEFAULT interval '5 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cutoff timestamptz;
  v_object_ids uuid[];
  v_hashtag_ids uuid[];
  v_mentions_deleted integer := 0;
  v_objects_deleted integer := 0;
  v_has_more boolean := false;
  v_batch_limit constant integer := 500;
BEGIN
  IF p_retention < interval '1 hour' THEN
    RAISE EXCEPTION 'Fediverse retention must be at least 1 hour';
  END IF;

  -- Avoid overlapping scheduled/manual invocations doing the same expensive work.
  IF NOT pg_try_advisory_xact_lock(hashtext('public.cleanup_expired_fediverse_content')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'cleanup already running');
  END IF;

  v_cutoff := now() - p_retention;

  SELECT coalesce(array_agg(expired.id), '{}'::uuid[])
    INTO v_object_ids
  FROM (
    SELECT id
    FROM public.federated_objects
    WHERE created_at < v_cutoff
    ORDER BY created_at ASC, id ASC
    LIMIT v_batch_limit
  ) AS expired;

  IF cardinality(v_object_ids) > 0 THEN
    SELECT coalesce(array_agg(DISTINCT hashtag_id), '{}'::uuid[])
      INTO v_hashtag_ids
    FROM public.federated_hashtag_mentions
    WHERE object_id = ANY(v_object_ids);

    DELETE FROM public.federated_hashtag_mentions
    WHERE object_id = ANY(v_object_ids);
    GET DIAGNOSTICS v_mentions_deleted = ROW_COUNT;

    DELETE FROM public.federated_objects
    WHERE id = ANY(v_object_ids);
    GET DIAGNOSTICS v_objects_deleted = ROW_COUNT;

    IF cardinality(v_hashtag_ids) > 0 THEN
      UPDATE public.hashtags h
         SET federated_post_count = (
           SELECT count(*)
           FROM public.federated_hashtag_mentions m
           WHERE m.hashtag_id = h.id
         )
       WHERE h.id = ANY(v_hashtag_ids);
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.federated_objects WHERE created_at < v_cutoff
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'ok', true,
    'retention_hours', extract(epoch FROM p_retention) / 3600,
    'cutoff', v_cutoff,
    'batch_limit', v_batch_limit,
    'mentions_deleted', v_mentions_deleted,
    'objects_deleted', v_objects_deleted,
    'has_more', v_has_more
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_fediverse_content(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_fediverse_content(interval) FROM anon, authenticated;

-- The former all-at-once cleanup could scan/aggregate/delete every expired row
-- in one transaction. Drain backlog in bounded batches every five minutes.
DO $schedule$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE command ILIKE '%cleanup_expired_fediverse_content%'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'testagram-fediverse-retention-batched',
    '*/5 * * * *',
    $job$SELECT public.cleanup_expired_fediverse_content(interval '5 hours');$job$
  );
END;
$schedule$;
