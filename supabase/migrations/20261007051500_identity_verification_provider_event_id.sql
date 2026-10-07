alter table public.identity_verification_events add column if not exists provider_event_id text;
create unique index if not exists identity_verification_events_provider_event_id_idx on public.identity_verification_events(provider_event_id) where provider_event_id is not null;
