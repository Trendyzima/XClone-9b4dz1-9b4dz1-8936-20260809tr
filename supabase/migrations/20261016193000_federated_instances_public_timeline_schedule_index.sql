-- Bound the public-timeline scheduler query on the 50k-row instance registry.
-- The existing next_sync_at-only index must walk entries and discard rows where
-- public_timeline_available is false. Put the equality predicate first so the
-- planner can seek directly to the requested availability state and preserve
-- next_sync_at ordering, including NULLS FIRST.
create index if not exists federated_instances_public_timeline_next_sync_idx
  on public.federated_instances (public_timeline_available, next_sync_at asc nulls first);

comment on index public.federated_instances_public_timeline_next_sync_idx is
  'Supports public_timeline_available equality filters ordered by next_sync_at for bounded Fediverse sync scheduling.';
