create table if not exists public.fediverse_instance_sync_state (
  domain text primary key,
  last_synced_at timestamptz not null default 'epoch',
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.fediverse_instance_sync_state enable row level security;
revoke all on public.fediverse_instance_sync_state from anon, authenticated;
