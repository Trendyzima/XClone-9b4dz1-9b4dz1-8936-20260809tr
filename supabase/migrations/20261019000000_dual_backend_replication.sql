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
    payload JSONB NOT NULL CHECK (octet_length(payload::text) <= 1048576),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error_code TEXT,
    CONSTRAINT replication_outbox_entity_version_unique
      UNIQUE (origin, entity_type, entity_id, entity_version)
);
CREATE INDEX IF NOT EXISTS platform_replication_outbox_ready_idx
  ON platform_replication_outbox (available_at, created_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS platform_replication_inbox (
    event_id UUID PRIMARY KEY,
    origin TEXT NOT NULL CHECK (length(origin) BETWEEN 1 AND 128),
    entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 128),
    entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
    entity_version BIGINT NOT NULL CHECK (entity_version > 0),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 128),
    payload_hash BYTEA NOT NULL CHECK (octet_length(payload_hash) = 32),
    payload JSONB NOT NULL CHECK (octet_length(payload::text) <= 1048576),
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
  ON platform_replication_inbox (received_at)
  WHERE applied_at IS NULL AND outcome IN ('received', 'retry');

-- These queues are internal control-plane data, never browser-accessible.
REVOKE ALL ON platform_replication_outbox, platform_replication_inbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_replication_outbox, platform_replication_inbox TO service_role;


-- Relay functions use bounded claims and short leases so overlapping invocations
-- cannot claim the same row. They are service-role-only control-plane operations.
CREATE OR REPLACE FUNCTION public.claim_platform_replication_outbox(
  p_limit INTEGER DEFAULT 50,
  p_lease_seconds INTEGER DEFAULT 30
)
RETURNS TABLE (
  event_id UUID, origin TEXT, entity_type TEXT, entity_id TEXT,
  entity_version BIGINT, schema_version INTEGER, event_type TEXT,
  occurred_at TIMESTAMPTZ, payload JSONB, attempts INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $
  WITH picked AS (
    SELECT o.event_id
    FROM public.platform_replication_outbox AS o
    WHERE o.delivered_at IS NULL
      AND o.available_at <= now()
      AND (o.lease_until IS NULL OR o.lease_until < now())
    ORDER BY o.created_at, o.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  )
  UPDATE public.platform_replication_outbox AS o
  SET lease_until = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 30), 5), 300)),
      attempts = o.attempts + 1
  FROM picked
  WHERE o.event_id = picked.event_id
  RETURNING o.event_id, o.origin, o.entity_type, o.entity_id,
            o.entity_version, o.schema_version, o.event_type,
            o.occurred_at, o.payload, o.attempts;
$;

CREATE OR REPLACE FUNCTION public.mark_platform_replication_delivered(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $
DECLARE changed INTEGER;
BEGIN
  UPDATE public.platform_replication_outbox
  SET delivered_at = now(), lease_until = NULL, last_error_code = NULL
  WHERE event_id = p_event_id AND delivered_at IS NULL AND lease_until > now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$;

CREATE OR REPLACE FUNCTION public.retry_platform_replication_event(p_event_id UUID, p_error_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $
DECLARE changed INTEGER;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Za-z0-9_-]{1,64}
 THEN
    RAISE EXCEPTION 'invalid replication error code';
  END IF;
  UPDATE public.platform_replication_outbox
  SET lease_until = NULL,
      available_at = now() + LEAST(3600, (5 * power(2, LEAST(attempts, 10)))::INTEGER) * interval '1 second',
      last_error_code = p_error_code
  WHERE event_id = p_event_id AND delivered_at IS NULL AND lease_until IS NOT NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$;

REVOKE ALL ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_platform_replication_delivered(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_platform_replication_event(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_replication_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_platform_replication_delivered(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_platform_replication_event(UUID, TEXT) TO service_role;

COMMIT;
