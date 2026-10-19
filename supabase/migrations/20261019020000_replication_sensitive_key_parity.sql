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

COMMIT;
