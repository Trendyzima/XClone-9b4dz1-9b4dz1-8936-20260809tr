alter table private.identity_engine_results
  add column if not exists engine_nonce text,
  add column if not exists engine_timestamp timestamptz;

create unique index if not exists identity_engine_results_engine_nonce_idx
  on private.identity_engine_results(engine_nonce)
  where engine_nonce is not null;

create unique index if not exists identity_verification_events_provider_event_id_idx
  on public.identity_verification_events(provider_event_id)
  where provider_event_id is not null;
