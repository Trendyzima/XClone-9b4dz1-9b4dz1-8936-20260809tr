-- Testagram TV: reconcile the YouTube-first control plane after the Cloudflare-primary migration.
-- The current production TV path uses a Vercel browser encoder -> YouTube RTMPS
-- plus Supabase lifecycle control. Completed YouTube broadcasts must never be
-- treated as active, and the encoder-session table is required by that path.

alter table public.live_streams drop constraint if exists live_streams_active_provider_check;
alter table public.live_streams
  add constraint live_streams_active_provider_check
  check (not is_live or tv_provider in ('youtube','cloudflare','native-p2p'));

create table if not exists public.tv_youtube_encoder_sessions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  revoked_at timestamptz
);

create index if not exists tv_youtube_encoder_sessions_stream_idx
  on public.tv_youtube_encoder_sessions(stream_id);

create index if not exists tv_youtube_encoder_sessions_active_idx
  on public.tv_youtube_encoder_sessions(stream_id, token_hash, expires_at)
  where revoked_at is null;

alter table public.tv_youtube_encoder_sessions enable row level security;
revoke all on public.tv_youtube_encoder_sessions from anon, authenticated;

notify pgrst, 'reload schema';