-- Secondary IPTV/World TV catalog storage contract.
-- Data is written by trusted server-side catalog ingestion only.
-- Browser/mobile clients have SELECT-only access through the secondary publishable key.

create table if not exists public.tv_catalog_channels (
  channel_id text primary key,
  tvg_id text,
  name text not null,
  stream_url text not null,
  logo_url text,
  country text,
  language text,
  group_name text,
  source text,
  source_id text,
  priority numeric not null default 0,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tv_catalog_health (
  channel_id text primary key,
  is_online boolean not null default false,
  last_checked_at timestamptz,
  latency_ms integer,
  consecutive_successes integer not null default 0,
  priority numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.tv_catalog_sync_state (
  source_id text primary key,
  source_label text,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  channel_count integer not null default 0,
  active_channel_count integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.tv_catalog_channels enable row level security;
alter table public.tv_catalog_health enable row level security;
alter table public.tv_catalog_sync_state enable row level security;

drop policy if exists tv_catalog_channels_public_read on public.tv_catalog_channels;
create policy tv_catalog_channels_public_read on public.tv_catalog_channels
  for select to anon, authenticated using (is_active = true);

drop policy if exists tv_catalog_health_public_read on public.tv_catalog_health;
create policy tv_catalog_health_public_read on public.tv_catalog_health
  for select to anon, authenticated using (true);

drop policy if exists tv_catalog_sync_state_public_read on public.tv_catalog_sync_state;
create policy tv_catalog_sync_state_public_read on public.tv_catalog_sync_state
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.tv_catalog_channels,
  public.tv_catalog_health, public.tv_catalog_sync_state from anon, authenticated;
grant select on public.tv_catalog_channels, public.tv_catalog_health,
  public.tv_catalog_sync_state to anon, authenticated;
