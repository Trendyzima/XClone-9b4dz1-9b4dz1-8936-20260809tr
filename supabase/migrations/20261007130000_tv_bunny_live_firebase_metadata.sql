-- Testagram TV: Bunny Stream Live is the sole public live-media provider.
-- Firebase Firestore is the authoritative metadata mirror; Supabase remains auth/signaling/control support.
-- No live video blobs are stored by Testagram. Bunny VOD recording is explicitly disabled.

alter table public.live_streams
  add column if not exists bunny_live_stream_id text,
  add column if not exists bunny_playback_url text,
  add column if not exists bunny_ingest_url text;

alter table public.live_streams drop constraint if exists live_streams_active_provider_check;
alter table public.live_streams drop constraint if exists live_streams_tv_provider_check;

alter table public.live_streams
  add constraint live_streams_active_provider_check
  check (not is_live or tv_provider='bunny');

alter table public.live_streams
  add constraint live_streams_tv_provider_check
  check (tv_provider in ('bunny','native-p2p'));

create unique index if not exists live_streams_bunny_id_idx
  on public.live_streams(bunny_live_stream_id)
  where bunny_live_stream_id is not null;

create table if not exists public.tv_bunny_encoder_sessions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  bunny_live_stream_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  revoked_at timestamptz
);

create index if not exists tv_bunny_encoder_sessions_stream_idx
  on public.tv_bunny_encoder_sessions(stream_id);

create index if not exists tv_bunny_encoder_sessions_active_idx
  on public.tv_bunny_encoder_sessions(stream_id,token_hash,expires_at)
  where revoked_at is null;

alter table public.tv_bunny_encoder_sessions enable row level security;
revoke all on public.tv_bunny_encoder_sessions from anon, authenticated;

notify pgrst,'reload schema';
