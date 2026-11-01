-- Bound federation cleanup, preserve durable interactions, and expire cached remote media.
-- Apply only to the primary Testagram Supabase project: the secondary data-plane
-- project does not own the federated-media bucket or this federation schema.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- The five-hour post cache is disposable only when no durable interaction or
-- reply chain depends on the remote object. Keep the indexed oldest-first batch.
CREATE OR REPLACE FUNCTION public.cleanup_expired_fediverse_content(
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
  v_hashtag_ids uuid[];
  v_mentions_deleted integer := 0;
  v_objects_deleted integer := 0;
  v_has_more boolean := false;
  v_batch_limit constant integer := 500;
BEGIN
  IF p_retention < interval '1 hour' THEN
    RAISE EXCEPTION 'Fediverse retention must be at least 1 hour';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('public.cleanup_expired_fediverse_content')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'cleanup already running');
  END IF;

  v_cutoff := now() - p_retention;

  SELECT coalesce(array_agg(expired.id ORDER BY expired.created_at, expired.id), '{}'::uuid[])
    INTO v_object_ids
  FROM (
    SELECT fo.id, fo.created_at
    FROM public.federated_objects AS fo
    WHERE fo.created_at < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_interactions AS fi
        WHERE fi.object_uri = fo.uri AND fi.active IS TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_bookmarks AS fb
        WHERE fb.object_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_quotes AS fq
        WHERE fq.object_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_replies AS fr
        WHERE fr.object_uri = fo.uri OR fr.parent_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_emoji_reactions AS fer
        WHERE fer.object_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_reactions AS frx
        WHERE frx.object_uri = fo.uri
      )
    ORDER BY fo.created_at ASC, fo.id ASC
    LIMIT v_batch_limit + 1
  ) AS expired;

  v_has_more := cardinality(v_object_ids) > v_batch_limit;
  v_object_ids := v_object_ids[1:v_batch_limit];

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
      UPDATE public.hashtags AS h
         SET federated_post_count = counts.mention_count
        FROM (
          SELECT affected.hashtag_id,
                 count(m.hashtag_id)::integer AS mention_count
          FROM unnest(v_hashtag_ids) AS affected(hashtag_id)
          LEFT JOIN public.federated_hashtag_mentions AS m
            ON m.hashtag_id = affected.hashtag_id
          GROUP BY affected.hashtag_id
        ) AS counts
       WHERE h.id = counts.hashtag_id;
    END IF;
  END IF;

  -- Report whether eligible (unreferenced) expired content remains. The indexed
  -- created_at/id order keeps this bounded and avoids counting the full backlog.
  SELECT EXISTS (
    SELECT 1
    FROM public.federated_objects AS fo
    WHERE fo.created_at < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_interactions AS fi
        WHERE fi.object_uri = fo.uri AND fi.active IS TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_bookmarks AS fb
        WHERE fb.object_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_quotes AS fq
        WHERE fq.object_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_replies AS fr
        WHERE fr.object_uri = fo.uri OR fr.parent_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_emoji_reactions AS fer
        WHERE fer.object_uri = fo.uri
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.federated_reactions AS frx
        WHERE frx.object_uri = fo.uri
      )
    LIMIT 1
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

REVOKE ALL ON FUNCTION public.cleanup_expired_fediverse_content(interval) FROM PUBLIC, anon, authenticated;

-- Bound inbox/outbox/cache/view cleanup too. These tables are operational
-- ledgers or disposable caches; pending/unprocessed activities are preserved.
CREATE INDEX IF NOT EXISTS federated_post_views_viewed_at_idx
  ON public.federated_post_views (viewed_at);

CREATE OR REPLACE FUNCTION public.cleanup_federation_storage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_inbox bigint := 0;
  v_outbox bigint := 0;
  v_cache bigint := 0;
  v_views bigint := 0;
  v_activities_compacted bigint := 0;
  v_batch_limit constant integer := 500;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('public.cleanup_federation_storage')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'cleanup already running');
  END IF;

  WITH expired AS (
    SELECT id FROM public.activitypub_inbox
    WHERE processed IS TRUE AND expires_at < now()
    ORDER BY expires_at ASC, id ASC
    LIMIT v_batch_limit
  )
  DELETE FROM public.activitypub_inbox AS inbox
  USING expired
  WHERE inbox.id = expired.id;
  GET DIAGNOSTICS v_inbox = ROW_COUNT;

  WITH expired AS (
    SELECT id FROM public.activitypub_outbox
    WHERE delivered IS TRUE AND expires_at < now()
    ORDER BY expires_at ASC, id ASC
    LIMIT v_batch_limit
  )
  DELETE FROM public.activitypub_outbox AS outbox
  USING expired
  WHERE outbox.id = expired.id;
  GET DIAGNOSTICS v_outbox = ROW_COUNT;

  WITH expired AS (
    SELECT cache_key FROM public.federation_remote_cache
    WHERE expires_at < now()
    ORDER BY expires_at, cache_key
    LIMIT v_batch_limit
  )
  DELETE FROM public.federation_remote_cache AS cache
  USING expired
  WHERE cache.cache_key = expired.cache_key;
  GET DIAGNOSTICS v_cache = ROW_COUNT;

  WITH expired AS (
    SELECT ctid FROM public.federated_post_views
    WHERE viewed_at < now() - interval '12 hours'
    ORDER BY viewed_at ASC
    LIMIT v_batch_limit
  )
  DELETE FROM public.federated_post_views AS views
  USING expired
  WHERE views.ctid = expired.ctid;
  GET DIAGNOSTICS v_views = ROW_COUNT;

  -- Keep the activity URI and processing metadata as the deduplication ledger,
  -- but discard bulky raw payloads after 30 days once processing is complete.
  WITH expired AS (
    SELECT id FROM public.federated_activities
    WHERE processing_state = 'processed'
      AND processed_at < now() - interval '30 days'
      AND raw_activity <> '{}'::jsonb
    ORDER BY processed_at ASC, id ASC
    LIMIT v_batch_limit
  )
  UPDATE public.federated_activities AS activity
     SET raw_activity = '{}'::jsonb
    FROM expired
   WHERE activity.id = expired.id;
  GET DIAGNOSTICS v_activities_compacted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_limit_per_table', v_batch_limit,
    'inbox_deleted', v_inbox,
    'outbox_deleted', v_outbox,
    'remote_cache_deleted', v_cache,
    'views_deleted', v_views,
    'activity_payloads_compacted', v_activities_compacted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_federation_storage() FROM PUBLIC, anon, authenticated;

-- Normalize any legacy schedule to one bounded 15-minute job.
DO $schedule$
DECLARE existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job
    WHERE command ILIKE '%cleanup_federation_storage%'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'testagram-federation-storage-batched',
    '*/15 * * * *',
    'SELECT public.cleanup_federation_storage();'
  );
END;
$schedule$;

-- The Edge Function checks the scheduler's high-entropy Vault token through
-- this narrow RPC; never expose the Vault value to the caller.
CREATE OR REPLACE FUNCTION public.verify_federation_worker_token(candidate text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, vault
AS $function$
  SELECT candidate IS NOT NULL
     AND length(candidate) >= 32
     AND candidate = (
       SELECT decrypted_secret
       FROM vault.decrypted_secrets
       WHERE name = 'federation_worker_token'
       LIMIT 1
     );
$function$;

REVOKE ALL ON FUNCTION public.verify_federation_worker_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_federation_worker_token(text) TO service_role;

-- Media cache paths are SHA-256(remote URL) and are not canonical user uploads.
-- Store a single cursor so every 15-minute invocation scans a bounded set of
-- prefixes and drains old objects oldest-first without a full-bucket listing.
CREATE TABLE IF NOT EXISTS public.federated_media_cleanup_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton IS TRUE),
  next_prefix integer NOT NULL DEFAULT 0 CHECK (next_prefix BETWEEN 0 AND 255),
  last_run_at timestamptz,
  last_deleted_count integer NOT NULL DEFAULT 0 CHECK (last_deleted_count >= 0),
  last_prefixes_scanned integer NOT NULL DEFAULT 0 CHECK (last_prefixes_scanned >= 0),
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.federated_media_cleanup_state(singleton, next_prefix)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.federated_media_cleanup_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.federated_media_cleanup_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.federated_media_cleanup_state TO service_role;

DO $media_schedule$
DECLARE existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job
    WHERE command ILIKE '%/functions/v1/federated-media-cleanup%'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'testagram-federated-media-cache-retention',
    '*/15 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'federation_project_url')
               || '/functions/v1/federated-media-cleanup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'federation_publishable_key'),
          'x-federation-worker-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'federation_worker_token')
        ),
        body := jsonb_build_object('source', 'pg_cron', 'at', now()),
        timeout_milliseconds := 15000
      );
    $job$
  );
END;
$media_schedule$;

COMMIT;
