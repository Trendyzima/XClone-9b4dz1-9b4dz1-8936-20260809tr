-- The five-hour retention cleanup orders and filters by created_at. Without a
-- matching index, each five-minute run can scan/sort the entire federated_objects
-- table twice (batch selection and has_more detection), competing with federation
-- reads/writes and contributing to PostgREST statement timeouts.
--
-- Match the cleanup's exact access path: oldest-first, deterministic bounded batch.
CREATE INDEX IF NOT EXISTS federated_objects_created_at_id_idx
  ON public.federated_objects (created_at ASC, id ASC);
