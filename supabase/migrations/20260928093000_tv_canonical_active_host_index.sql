-- Consolidate the TV broadcast invariant to the canonical host constraint.
-- The host constraint is the single source of truth for one active broadcast per broadcaster.
drop index if exists public.live_streams_one_active_per_user;

create unique index if not exists live_streams_one_active_per_host_idx
  on public.live_streams (user_id)
  where is_live = true;
