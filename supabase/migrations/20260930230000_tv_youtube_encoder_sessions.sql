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
create index if not exists tv_youtube_encoder_sessions_stream_idx on public.tv_youtube_encoder_sessions(stream_id);
create index if not exists tv_youtube_encoder_sessions_active_idx on public.tv_youtube_encoder_sessions(stream_id, token_hash, expires_at) where revoked_at is null;
alter table public.tv_youtube_encoder_sessions enable row level security;
revoke all on public.tv_youtube_encoder_sessions from anon, authenticated;
