-- Prevent duplicate telemetry for a single ZenAd impression/event type.
-- The event endpoint is intentionally callable without a user JWT, so the
-- database must provide the final idempotency boundary after token validation.
drop index if exists public.zenad_click_once_idx;
create unique index if not exists zenad_events_impression_type_once_idx
  on public.zenad_events (impression_id, event_type);
