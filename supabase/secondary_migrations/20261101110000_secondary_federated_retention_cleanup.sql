-- Secondary data-plane federation retention.
-- This project has a distinct federation schema from the primary project and
-- no federated-media Storage bucket. Keep only schema-verified cleanup here.

CREATE OR REPLACE FUNCTION public.cleanup_expired_federation_interactions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_batch_limit constant integer := 500;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('public.cleanup_expired_federation_interactions')) THEN
    RETURN;
  END IF;

  WITH expired AS (
    SELECT id FROM public.federation_remote_engagements
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at, id LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_engagements AS target USING expired
  WHERE target.id = expired.id;

  WITH expired AS (
    SELECT id FROM public.federation_remote_bookmarks
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at, id LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_bookmarks AS target USING expired
  WHERE target.id = expired.id;

  WITH expired AS (
    SELECT id FROM public.federation_remote_quotes
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at, id LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_quotes AS target USING expired
  WHERE target.id = expired.id;

  WITH expired AS (
    SELECT id FROM public.federation_remote_replies
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at, id LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_replies AS target USING expired
  WHERE target.id = expired.id;

  WITH expired AS (
    SELECT id FROM public.federation_remote_reposts
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at, id LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_reposts AS target USING expired
  WHERE target.id = expired.id;

  WITH expired AS (
    SELECT id FROM public.federation_remote_likes
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at, id LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_likes AS target USING expired
  WHERE target.id = expired.id;

  WITH expired AS (
    SELECT id FROM public.federation_remote_interactions
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at, id LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_interactions AS target USING expired
  WHERE target.id = expired.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_federation_interactions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_expired_secondary_federated_content(
  p_retention interval DEFAULT interval '5 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_cutoff timestamptz;
  v_object_ids uuid[];
  v_objects_deleted integer := 0;
  v_timeline_deleted integer := 0;
  v_webfinger_deleted integer := 0;
  v_replays_deleted integer := 0;
  v_has_more boolean := false;
  v_batch_limit constant integer := 500;
BEGIN
  IF p_retention < interval '1 hour' THEN
    RAISE EXCEPTION 'Federated content retention must be at least 1 hour';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('public.cleanup_expired_secondary_federated_content')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'cleanup already running');
  END IF;

  v_cutoff := now() - p_retention;

  -- Timeline entries are a feed cache, not durable bookmarks or interactions.
  WITH expired AS (
    SELECT id FROM public.federation_timeline_entries
    WHERE created_at < now() - interval '12 hours'
    ORDER BY created_at, id
    LIMIT v_batch_limit
  )
  DELETE FROM public.federation_timeline_entries AS target USING expired
  WHERE target.id = expired.id;
  GET DIAGNOSTICS v_timeline_deleted = ROW_COUNT;

  -- Replay keys and WebFinger responses are caches with explicit expirations.
  WITH expired AS (
    SELECT resource FROM public.federation_webfinger_cache
    WHERE expires_at < now()
    ORDER BY expires_at, resource
    LIMIT v_batch_limit
  )
  DELETE FROM public.federation_webfinger_cache AS target USING expired
  WHERE target.resource = expired.resource;
  GET DIAGNOSTICS v_webfinger_deleted = ROW_COUNT;

  WITH expired AS (
    SELECT id FROM public.federation_replays
    WHERE expires_at < now()
    ORDER BY expires_at, id
    LIMIT v_batch_limit
  )
  DELETE FROM public.federation_replays AS target USING expired
  WHERE target.id = expired.id;
  GET DIAGNOSTICS v_replays_deleted = ROW_COUNT;

  -- Keep the remote object only while a durable local interaction or a newer
  -- child object depends on it. Local posts are in public.posts and are untouched.
  SELECT coalesce(array_agg(expired.id ORDER BY expired.created_at, expired.id), '{}'::uuid[])
    INTO v_object_ids
  FROM (
    SELECT fo.id, fo.created_at
    FROM public.federated_objects AS fo
    WHERE fo.created_at < v_cutoff
      AND fo.deleted_at IS NULL
      AND fo.tombstone IS FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_object_interactions AS i
        WHERE i.object_uri = fo.uri AND i.active IS TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_object_reactions AS r
        WHERE r.object_uri = fo.uri AND r.active IS TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_interactions AS i
        WHERE i.object_uri = fo.uri AND i.active IS TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_local_interactions AS i
        WHERE i.object_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federation_remote_bookmarks AS b
        WHERE b.object_url = fo.uri AND (b.expires_at IS NULL OR b.expires_at > now())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federation_remote_quotes AS q
        WHERE (q.object_uri = fo.uri OR q.object_url = fo.uri)
          AND q.revoked_at IS NULL AND (q.expires_at IS NULL OR q.expires_at > now())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federation_remote_replies AS r
        WHERE (r.object_uri = fo.uri OR r.object_url = fo.uri)
          AND (r.expires_at IS NULL OR r.expires_at > now())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federation_remote_likes AS l
        WHERE l.object_url = fo.uri AND (l.expires_at IS NULL OR l.expires_at > now())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federation_remote_reposts AS r
        WHERE r.object_url = fo.uri AND (r.expires_at IS NULL OR r.expires_at > now())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federation_remote_interactions AS i
        WHERE i.object_url = fo.uri AND (i.expires_at IS NULL OR i.expires_at > now())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federation_remote_engagements AS e
        WHERE e.object_url = fo.uri AND (e.expires_at IS NULL OR e.expires_at > now())
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_objects AS child
        WHERE child.in_reply_to_uri = fo.uri OR child.quote_uri = fo.uri
      )
    ORDER BY fo.created_at, fo.id
    LIMIT v_batch_limit + 1
  ) AS expired;

  v_has_more := cardinality(v_object_ids) > v_batch_limit;
  v_object_ids := v_object_ids[1:v_batch_limit];

  IF cardinality(v_object_ids) > 0 THEN
    DELETE FROM public.federated_objects
    WHERE id = ANY(v_object_ids);
    GET DIAGNOSTICS v_objects_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'retention_hours', extract(epoch FROM p_retention) / 3600,
    'cutoff', v_cutoff,
    'batch_limit', v_batch_limit,
    'objects_deleted', v_objects_deleted,
    'timeline_entries_deleted', v_timeline_deleted,
    'webfinger_cache_deleted', v_webfinger_deleted,
    'replay_keys_deleted', v_replays_deleted,
    'has_more', v_has_more
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_secondary_federated_content(interval) FROM PUBLIC, anon, authenticated;

DO $schedule$
DECLARE existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job
    WHERE command ILIKE '%cleanup_expired_federation_interactions%'
       OR command ILIKE '%cleanup_expired_secondary_federated_content%'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'testagram-federation-interaction-cleanup',
    '*/15 * * * *',
    'SELECT public.cleanup_expired_federation_interactions();'
  );

  PERFORM cron.schedule(
    'testagram-secondary-federated-content-retention',
    '*/5 * * * *',
    $$SELECT public.cleanup_expired_secondary_federated_content(interval '5 hours');$$
  );
END;
$schedule$;
