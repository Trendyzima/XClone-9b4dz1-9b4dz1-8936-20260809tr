-- Testagram TV: Cloudflare Stream is the sole public live-media transport.
-- Supabase remains the TV control plane; Cloudflare TURN remains the guest WebRTC path.
-- YouTube is a Cloudflare Stream output, not a second encoder.

alter table public.live_streams
  add column if not exists cloudflare_input_id text,
  add column if not exists cloudflare_output_id text,
  add column if not exists cloudflare_video_id text,
  add column if not exists cloudflare_playback_url text,
  add column if not exists youtube_output_id text,
  add column if not exists youtube_status text not null default 'disabled',
  add column if not exists youtube_error text;

alter table public.live_streams drop constraint if exists live_streams_active_provider_check;

update public.live_streams
set is_live=false,
    ended_at=coalesce(ended_at,now()),
    stream_url=null,
    tv_connection_state='offline',
    tv_last_heartbeat_at=null,
    tv_host_peer_id=null,
    viewer_count=0
where is_live=true and tv_provider<>'cloudflare';

alter table public.live_streams
  add constraint live_streams_active_provider_check
  check (not is_live or tv_provider='cloudflare');

drop table if exists public.tv_mux_encoder_sessions;
drop index if exists public.live_streams_mux_live_stream_idx;

alter table public.live_streams
  drop column if exists mux_live_stream_id,
  drop column if exists mux_playback_id,
  drop column if exists mux_active_asset_id,
  drop column if exists mux_status,
  drop column if exists youtube_simulcast_target_id,
  drop column if exists youtube_broadcast_id,
  drop column if exists youtube_stream_id,
  drop column if exists youtube_video_id;

-- Recreate the Cloudflare YouTube-output identifier cleanly after retiring any older shape.
alter table public.live_streams drop column if exists youtube_output_id;
alter table public.live_streams add column youtube_output_id text;

create index if not exists live_streams_cloudflare_input_idx on public.live_streams(cloudflare_input_id) where cloudflare_input_id is not null;
create index if not exists live_streams_cloudflare_video_idx on public.live_streams(cloudflare_video_id) where cloudflare_video_id is not null;
create index if not exists live_streams_youtube_output_idx on public.live_streams(youtube_output_id) where youtube_output_id is not null;

create table if not exists public.tv_cloudflare_encoder_sessions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  revoked_at timestamptz
);
create index if not exists tv_cloudflare_encoder_sessions_stream_idx on public.tv_cloudflare_encoder_sessions(stream_id);
create index if not exists tv_cloudflare_encoder_sessions_active_idx on public.tv_cloudflare_encoder_sessions(stream_id,token_hash,expires_at) where revoked_at is null;
alter table public.tv_cloudflare_encoder_sessions enable row level security;
revoke all on public.tv_cloudflare_encoder_sessions from anon, authenticated;

notify pgrst,'reload schema';
