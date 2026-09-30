-- Testagram TV: durable Mux lifecycle reconciliation.
create table if not exists public.tv_mux_webhook_events (
  event_id text primary key,
  event_type text not null,
  mux_live_stream_id text,
  simulcast_target_id text,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists tv_mux_webhook_events_live_stream_idx
  on public.tv_mux_webhook_events(mux_live_stream_id, received_at desc);

alter table public.tv_mux_webhook_events enable row level security;

notify pgrst, 'reload schema';