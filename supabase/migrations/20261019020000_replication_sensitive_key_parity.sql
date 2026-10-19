-- Keep the SQL-side sensitive-field policy aligned with the Go receiver and
-- the shared replication-event contract. This is additive so deployed migration
-- history remains immutable.
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_replication_has_forbidden_key(p_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $producer$
DECLARE
  key_name TEXT;
  normalized_key TEXT;
  child JSONB;
  forbidden TEXT[] := ARRAY[
    'authorization','access_token','refresh_token','token','bearer','jwt',
    'password','password_hash','passwd','email','email_address','phone','phone_number',
    'private_key','service_role','service_role_key','secret_key','secret',
    'credential','credentials','signed_url','presigned_url','upload_url',
    'session','cookie','api_key'
  ];
BEGIN
  IF jsonb_typeof(p_value) = 'object' THEN
    FOR key_name, child IN SELECT key, value FROM jsonb_each(p_value)
    LOOP
      normalized_key := lower(regexp_replace(
        regexp_replace(key_name, '([a-z0-9])([A-Z])', '\1_\2', 'g'),
        '[^A-Za-z0-9]+', '_', 'g'
      ));
      IF EXISTS (
           SELECT 1 FROM unnest(forbidden) AS forbidden_key(value)
           WHERE position(forbidden_key.value in normalized_key) > 0
         )
         OR (
           right(normalized_key, 4) = '_url'
           AND jsonb_typeof(child) = 'string'
           AND (
             position('?' in child #>> '{}') > 0
             OR position('#' in child #>> '{}') > 0
             OR position('@' in split_part(child #>> '{}', '/', 3)) > 0
           )
         )
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

REVOKE ALL ON FUNCTION public.platform_replication_has_forbidden_key(JSONB) FROM PUBLIC, anon, authenticated;


-- Match the peer receiver's transport limit and reject unsupported or mismatched
-- event types at the source, rather than queueing events the peer must reject.
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
  event_field_count INTEGER;
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_replication_event' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_event::text) > 1048576 THEN
    RAISE EXCEPTION 'replication_event_too_large' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO event_field_count FROM jsonb_object_keys(p_event);
  IF event_field_count <> 9 THEN
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

  IF event_id_value::TEXT !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR origin_value IS NULL OR origin_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR entity_type_value IS NULL OR entity_type_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR entity_id_value IS NULL OR entity_id_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR entity_version_value IS NULL OR entity_version_value < 1
     OR schema_version_value IS NULL OR schema_version_value <> 1
     OR event_type_value IS NULL OR event_type_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR left(lower(event_type_value), length(entity_type_value) + 1) <> (lower(entity_type_value) || '.')
     OR occurred_at_value IS NULL
     OR payload_value IS NULL OR jsonb_typeof(payload_value) IS DISTINCT FROM 'object'
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

REVOKE ALL ON FUNCTION public.enqueue_platform_replication_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_platform_replication_event(JSONB) TO service_role;

COMMIT;
