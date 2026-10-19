-- Dual-backend durable replication tables. This migration is additive and
-- intentionally does not change existing product tables or content.
BEGIN;

CREATE TABLE IF NOT EXISTS platform_replication_outbox (
    event_id UUID PRIMARY KEY,
    origin TEXT NOT NULL CHECK (length(origin) BETWEEN 1 AND 128),
    entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 128),
    entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
    entity_version BIGINT NOT NULL CHECK (entity_version > 0),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 128),
    occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL CHECK (octet_length(payload::text) <= 2097152),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    lease_token UUID,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    last_error_code TEXT,
    CONSTRAINT replication_outbox_entity_version_unique
      UNIQUE (origin, entity_type, entity_id, entity_version)
);
CREATE INDEX IF NOT EXISTS platform_replication_outbox_ready_idx
  ON platform_replication_outbox (available_at, created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

CREATE TABLE IF NOT EXISTS platform_replication_inbox (
    event_id UUID PRIMARY KEY,
    origin TEXT NOT NULL CHECK (length(origin) BETWEEN 1 AND 128),
    entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 128),
    entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
    entity_version BIGINT NOT NULL CHECK (entity_version > 0),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 128),
    payload_hash BYTEA NOT NULL CHECK (octet_length(payload_hash) = 32),
    payload JSONB NOT NULL CHECK (octet_length(payload::text) <= 2097152),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at TIMESTAMPTZ,
    outcome TEXT NOT NULL DEFAULT 'received'
      CHECK (outcome IN ('received', 'applied', 'stale', 'rejected', 'retry')),
    error_code TEXT,
    UNIQUE (origin, entity_type, entity_id, entity_version)
);
CREATE INDEX IF NOT EXISTS platform_replication_inbox_pending_idx
  ON platform_replication_inbox (available_at, received_at)
  WHERE applied_at IS NULL AND outcome IN ('received', 'retry');

CREATE TABLE IF NOT EXISTS platform_replication_projection (
  origin TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version BIGINT NOT NULL CHECK (entity_version > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  payload JSONB NOT NULL CHECK (octet_length(payload::text) <= 2097152),
  tombstoned BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (origin, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS platform_replication_entity_versions (
    origin TEXT NOT NULL CHECK (length(origin) BETWEEN 1 AND 128),
    entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 128),
    entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
    current_version BIGINT NOT NULL CHECK (current_version > 0),
    tombstoned BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (origin, entity_type, entity_id)
);

-- These queues are internal control-plane data, never browser-accessible.
REVOKE ALL ON platform_replication_outbox, platform_replication_inbox, platform_replication_entity_versions, platform_replication_projection FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON platform_replication_projection TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_replication_outbox, platform_replication_inbox TO service_role;
GRANT SELECT, INSERT, UPDATE ON platform_replication_entity_versions TO service_role;


-- Relay functions use bounded claims and short leases so overlapping invocations
-- cannot claim the same row. They are service-role-only control-plane operations.
CREATE OR REPLACE FUNCTION public.claim_platform_replication_outbox(
  p_limit INTEGER DEFAULT 50,
  p_lease_seconds INTEGER DEFAULT 30
)
RETURNS TABLE (
  event_id UUID, origin TEXT, entity_type TEXT, entity_id TEXT,
  entity_version BIGINT, schema_version INTEGER, event_type TEXT,
  occurred_at TIMESTAMPTZ, payload JSONB, attempts INTEGER, lease_token UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $replication$
  WITH picked AS (
    SELECT o.event_id
    FROM public.platform_replication_outbox AS o
    WHERE o.delivered_at IS NULL AND o.failed_at IS NULL
      AND o.available_at <= now()
      AND (o.lease_until IS NULL OR o.lease_until < now())
    ORDER BY o.created_at, o.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  )
  UPDATE public.platform_replication_outbox AS o
  SET lease_until = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 30), 5), 300)),
      lease_token = gen_random_uuid(),
      attempts = o.attempts + 1
  FROM picked
  WHERE o.event_id = picked.event_id
  RETURNING o.event_id, o.origin, o.entity_type, o.entity_id,
            o.entity_version, o.schema_version, o.event_type,
            o.occurred_at, o.payload, o.attempts, o.lease_token;
$replication$;

CREATE OR REPLACE FUNCTION public.mark_platform_replication_delivered(p_event_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $replication$
DECLARE changed INTEGER;
BEGIN
  UPDATE public.platform_replication_outbox
  SET delivered_at = now(), lease_until = NULL, lease_token = NULL, last_error_code = NULL
  WHERE event_id = p_event_id AND lease_token = p_lease_token AND delivered_at IS NULL AND failed_at IS NULL AND lease_until > now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$replication$;

CREATE OR REPLACE FUNCTION public.retry_platform_replication_event(p_event_id UUID, p_lease_token UUID, p_error_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $replication$
DECLARE changed INTEGER;
BEGIN
  IF p_error_code IS NULL OR length(p_error_code) < 1 OR length(p_error_code) > 64
     OR translate(p_error_code, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-', '') <> '' THEN
    RAISE EXCEPTION 'invalid replication error code';
  END IF;
  UPDATE public.platform_replication_outbox
  SET lease_until = NULL, lease_token = NULL,
      failed_at = CASE WHEN attempts >= 20 THEN now() ELSE failed_at END,
      available_at = CASE WHEN attempts >= 20 THEN available_at
        ELSE now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second' END,
      last_error_code = p_error_code
  WHERE event_id = p_event_id AND lease_token = p_lease_token AND delivered_at IS NULL AND failed_at IS NULL AND lease_until IS NOT NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$replication$;

CREATE OR REPLACE FUNCTION public.platform_replication_has_forbidden_key(p_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $producer$
DECLARE
  key_name TEXT;
  child JSONB;
  forbidden TEXT[] := ARRAY[
    'authorization','access_token','refresh_token','password','password_hash',
    'email','phone','private_key','service_role_key','secret_key','signed_url',
    'presigned_url','upload_url','session','cookie','api_key'
  ];
BEGIN
  IF jsonb_typeof(p_value) = 'object' THEN
    FOR key_name, child IN SELECT key, value FROM jsonb_each(p_value)
    LOOP
      IF lower(replace(replace(key_name, '-', '_'), ' ', '_')) = ANY(forbidden)
         OR public.platform_replication_has_forbidden_key(child) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR child IN SELECT value FROM jsonb_array_elements(p_value) AS item(value)
    LOOP
      IF public.platform_replication_has_forbidden_key(child) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  END IF;
  RETURN FALSE;
END;
$producer$;

CREATE OR REPLACE FUNCTION public.enqueue_platform_replication_event(p_event JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $producer$
DECLARE
  event_id_value UUID;
  origin_value TEXT;
  entity_type_value TEXT;
  entity_id_value TEXT;
  entity_version_value BIGINT;
  schema_version_value INTEGER;
  event_type_value TEXT;
  occurred_at_value TIMESTAMPTZ;
  payload_value JSONB;
  inserted_id UUID;
  existing RECORD;
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_replication_event' USING ERRCODE = '22023';
  END IF;
  IF jsonb_object_length(p_event) <> 9 THEN
    RAISE EXCEPTION 'invalid_replication_event_fields' USING ERRCODE = '22023';
  END IF;
  event_id_value := (p_event->>'id')::UUID;
  origin_value := p_event->>'origin';
  entity_type_value := p_event->>'entity_type';
  entity_id_value := p_event->>'entity_id';
  entity_version_value := (p_event->>'entity_version')::BIGINT;
  schema_version_value := (p_event->>'schema_version')::INTEGER;
  event_type_value := p_event->>'event_type';
  occurred_at_value := (p_event->>'occurred_at')::TIMESTAMPTZ;
  payload_value := p_event->'payload';

  IF event_id_value::TEXT !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} OR entity_type_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media')
         OR left(lower(item.event_type), length(item.entity_type) + 1) <> (item.entity_type || '.') THEN
        RAISE EXCEPTION 'unsupported_entity_type_or_event_mismatch' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome=CASE WHEN attempts >= 19 THEN 'rejected' ELSE 'retry' END,
          applied_at=CASE WHEN attempts >= 19 THEN now() ELSE applied_at END,
          attempts=attempts+1,
          error_code=CASE WHEN attempts >= 19 THEN 'retry_exhausted' ELSE 'projection_failed' END,
          available_at=CASE WHEN attempts >= 19 THEN available_at
            ELSE now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second' END
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

     OR entity_id_value IS NULL OR entity_id_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media') THEN
        RAISE EXCEPTION 'unsupported_entity_type' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

     OR event_type_value IS NULL OR event_type_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media') THEN
        RAISE EXCEPTION 'unsupported_entity_type' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

     OR entity_version_value IS NULL OR entity_version_value < 1
     OR schema_version_value IS NULL OR schema_version_value < 1
     OR occurred_at_value IS NULL
     OR payload_value IS NULL OR jsonb_typeof(payload_value) <> 'object'
     OR octet_length(payload_value::text) > 1048576
     OR public.platform_replication_has_forbidden_key(payload_value) THEN
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media') THEN
        RAISE EXCEPTION 'unsupported_entity_type' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

     OR origin_value IS DISTINCT FROM 'xclone'
     OR entity_type_value IS NULL OR entity_type_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media')
         OR left(lower(item.event_type), length(item.entity_type) + 1) <> (item.entity_type || '.') THEN
        RAISE EXCEPTION 'unsupported_entity_type_or_event_mismatch' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome=CASE WHEN attempts >= 19 THEN 'rejected' ELSE 'retry' END,
          applied_at=CASE WHEN attempts >= 19 THEN now() ELSE applied_at END,
          attempts=attempts+1,
          error_code=CASE WHEN attempts >= 19 THEN 'retry_exhausted' ELSE 'projection_failed' END,
          available_at=CASE WHEN attempts >= 19 THEN available_at
            ELSE now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second' END
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

     OR entity_id_value IS NULL OR entity_id_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media') THEN
        RAISE EXCEPTION 'unsupported_entity_type' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

     OR event_type_value IS NULL OR event_type_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media') THEN
        RAISE EXCEPTION 'unsupported_entity_type' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

     OR entity_version_value IS NULL OR entity_version_value < 1
     OR schema_version_value IS NULL OR schema_version_value < 1
     OR occurred_at_value IS NULL
     OR payload_value IS NULL OR jsonb_typeof(payload_value) <> 'object'
     OR octet_length(payload_value::text) > 1048576
     OR public.platform_replication_has_forbidden_key(payload_value) THEN
    RAISE EXCEPTION 'replication_event_rejected' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_replication_outbox
    (event_id, origin, entity_type, entity_id, entity_version,
     schema_version, event_type, occurred_at, payload)
  VALUES (event_id_value, origin_value, entity_type_value, entity_id_value,
          entity_version_value, schema_version_value, event_type_value,
          occurred_at_value, payload_value)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN inserted_id;
  END IF;

  SELECT origin, entity_type, entity_id, entity_version, schema_version,
         event_type, occurred_at, payload
  INTO existing
  FROM public.platform_replication_outbox
  WHERE event_id = event_id_value;

  IF NOT FOUND OR existing.origin <> origin_value
     OR existing.entity_type <> entity_type_value
     OR existing.entity_id <> entity_id_value
     OR existing.entity_version <> entity_version_value
     OR existing.schema_version <> schema_version_value
     OR existing.event_type <> event_type_value
     OR existing.occurred_at <> occurred_at_value
     OR existing.payload <> payload_value THEN
    RAISE EXCEPTION 'replication_event_id_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN event_id_value;
END;
$producer$;

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_platform_replication_pending(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $project$
DECLARE
  item RECORD;
  data JSONB;
  is_deleted BOOLEAN;
  accepted_version BIGINT;
  applied_count INTEGER := 0;
  allowed_keys TEXT[];
  key_name TEXT;
BEGIN
  FOR item IN
    SELECT i.event_id, i.origin, i.entity_type, i.entity_id, i.entity_version,
           i.schema_version, i.event_type, i.payload
    FROM public.platform_replication_inbox AS i
    WHERE i.applied_at IS NULL AND i.outcome IN ('received', 'retry')
      AND i.available_at <= now()
    ORDER BY i.received_at, i.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  LOOP
    BEGIN
      data := item.payload->'payload';
      is_deleted := lower(item.event_type) LIKE '%.deleted'
                    OR lower(item.event_type) LIKE '%.tombstoned';
      IF item.entity_type NOT IN ('account', 'post', 'media') THEN
        RAISE EXCEPTION 'unsupported_entity_type' USING ERRCODE = '22023';
      END IF;
      IF NOT is_deleted AND (jsonb_typeof(data) <> 'object' OR data IS NULL) THEN
        RAISE EXCEPTION 'invalid_projection_payload' USING ERRCODE = '22023';
      END IF;

      IF item.entity_type = 'account' THEN
        allowed_keys := ARRAY['id','username','display_name','bio','avatar_key','avatar_url','website'];
      ELSIF item.entity_type = 'post' THEN
        allowed_keys := ARRAY['id','author_id','text','content','visibility','created_at','updated_at','media_ids','language'];
      ELSE
        allowed_keys := ARRAY['id','owner_id','object_key','content_type','size_bytes','checksum_sha256','visibility','created_at'];
      END IF;

      IF NOT is_deleted THEN
        FOR key_name IN SELECT jsonb_object_keys(data)
        LOOP
          IF NOT key_name = ANY(allowed_keys) THEN
            RAISE EXCEPTION 'projection_field_not_allowed' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        IF data ? 'id' AND data->>'id' <> item.entity_id THEN
          RAISE EXCEPTION 'projection_id_mismatch' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'account' AND data ? 'avatar_url' AND data->>'avatar_url' IS NOT NULL THEN
          IF data->>'avatar_url' !~ '^https://[^/?#]+[^?#]*
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
 OR position('?' in data->>'avatar_url') > 0 OR position('#' in data->>'avatar_url') > 0 THEN
            RAISE EXCEPTION 'avatar_url_must_be_stable_https' USING ERRCODE = '22023';
          END IF;
        END IF;
        IF item.entity_type = 'post' AND data->>'visibility' IS DISTINCT FROM 'public' THEN
          RAISE EXCEPTION 'only_public_posts_can_be_projected' USING ERRCODE = '22023';
        END IF;
        IF item.entity_type = 'media' AND (
          data->>'visibility' IS DISTINCT FROM 'public'
          OR NOT (data ? 'object_key')
          OR data->>'object_key' IS NULL
          OR data->>'object_key' = ''
          OR position('://' in data->>'object_key') > 0
          OR left(data->>'object_key', 1) = '/'
          OR position('..' in data->>'object_key') > 0
          OR length(data->>'object_key') > 1024
          OR data->>'content_type' NOT IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm')
          OR data->>'checksum_sha256' !~ '^[0-9a-fA-F]{64}
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;

          OR NOT (data ? 'size_bytes')
          OR CASE WHEN jsonb_typeof(data->'size_bytes') = 'number'
                  THEN (data->>'size_bytes')::numeric < 1 OR (data->>'size_bytes')::numeric > 524288000
                  ELSE TRUE END
        ) THEN
          RAISE EXCEPTION 'public_media_metadata_incomplete' USING ERRCODE = '22023';
        END IF;
      ELSE
        data := '{}'::jsonb;
      END IF;

      INSERT INTO public.platform_replication_entity_versions
        (origin, entity_type, entity_id, current_version, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET current_version = EXCLUDED.current_version,
          tombstoned = public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned,
          updated_at = now()
      WHERE public.platform_replication_entity_versions.current_version < EXCLUDED.current_version
        AND (NOT public.platform_replication_entity_versions.tombstoned OR EXCLUDED.tombstoned)
      RETURNING current_version INTO accepted_version;

      IF accepted_version IS NULL THEN
        UPDATE public.platform_replication_inbox
        SET applied_at = now(),
            outcome = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'rejected' ELSE 'stale' END,
            error_code = CASE WHEN EXISTS (
              SELECT 1 FROM public.platform_replication_entity_versions v
              WHERE v.origin=item.origin AND v.entity_type=item.entity_type
                AND v.entity_id=item.entity_id AND v.tombstoned
            ) AND NOT is_deleted THEN 'entity_tombstoned' ELSE 'stale_version' END
        WHERE event_id=item.event_id;
        CONTINUE;
      END IF;

      INSERT INTO public.platform_replication_projection
        (origin, entity_type, entity_id, entity_version, schema_version, payload, tombstoned)
      VALUES (item.origin, item.entity_type, item.entity_id, item.entity_version,
              item.schema_version, data, is_deleted)
      ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version,
          schema_version=EXCLUDED.schema_version,
          payload=EXCLUDED.payload,
          tombstoned=EXCLUDED.tombstoned,
          updated_at=now()
      WHERE public.platform_replication_projection.entity_version < EXCLUDED.entity_version;

      UPDATE public.platform_replication_inbox
      SET applied_at=now(), outcome='applied', error_code=NULL
      WHERE event_id=item.event_id;
      applied_count := applied_count + 1;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      UPDATE public.platform_replication_inbox
      SET outcome='rejected', applied_at=now(), error_code='projection_rejected'
      WHERE event_id=item.event_id;
    WHEN OTHERS THEN
      UPDATE public.platform_replication_inbox
      SET outcome='retry', attempts=attempts+1, error_code='projection_failed',
          available_at=now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second'
      WHERE event_id=item.event_id;
    END;
  END LOOP;
  RETURN applied_count;
END;
$project$;

REVOKE ALL ON FUNCTION public.apply_platform_replication_pending(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_platform_replication_pending(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, UUID, TEXT) TO service_role;

COMMIT;
