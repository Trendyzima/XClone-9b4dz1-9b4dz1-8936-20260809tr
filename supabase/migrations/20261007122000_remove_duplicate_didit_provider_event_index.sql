-- Keep the existing unique provider-event index and remove a duplicate index
-- created by an older identity-first migration revision.
drop index if exists public.identity_verification_events_provider_event_id_uidx;
