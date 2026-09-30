-- Testagram TV: make Mux the broadcast transport and keep WebRTC only for interactive guests.
-- Viewer media is delivered by Mux HLS; Supabase remains the authorization/control plane.
alter table public.live_streams
  add column if not exists mux_live_stream_id text,
  add column if not exists mux_playback_id text,
  add column if not exists mux_active_asset_id text,
  add column if not exists mux_status text not null default 'idle';

alter table public.live_streams
  drop constraint if exists live_streams_mux_status_check;
alter table public.live_streams
  add constraint live_streams_mux_status_check
  check (mux_status in ('idle','connected','recording','active','disconnected','errored'));

alter table public.live_streams
  drop constraint if exists live_streams_tv_provider_check;
alter table public.live_streams
  add constraint live_streams_tv_provider_check
  check (tv_provider in ('native-p2p','youtube','mux'));

create index if not exists live_streams_mux_live_stream_idx
  on public.live_streams(mux_live_stream_id)
  where mux_live_stream_id is not null;

create index if not exists live_streams_mux_playback_idx
  on public.live_streams(mux_playback_id)
  where mux_playback_id is not null;

create table if not exists public.tv_mux_encoder_sessions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tv_mux_encoder_sessions_stream_idx
  on public.tv_mux_encoder_sessions(stream_id, expires_at desc);

alter table public.tv_mux_encoder_sessions enable row level security;

drop policy if exists "tv_mux_encoder_sessions_owner_read" on public.tv_mux_encoder_sessions;
create policy "tv_mux_encoder_sessions_owner_read"
  on public.tv_mux_encoder_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.tv_mux_encoder_sessions to authenticated;

notify pgrst, 'reload schema';
