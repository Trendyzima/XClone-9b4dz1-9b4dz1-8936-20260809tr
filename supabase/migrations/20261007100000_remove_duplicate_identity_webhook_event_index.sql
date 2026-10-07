-- Keep a single unique provider event index for webhook idempotency.
drop index if exists public.identity_verification_events_provider_event_id_uidx;
