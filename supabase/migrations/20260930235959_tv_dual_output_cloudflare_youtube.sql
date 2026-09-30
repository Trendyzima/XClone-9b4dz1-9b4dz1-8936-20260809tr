-- Testagram TV dual-output transport: Cloudflare is Testagram's live distribution origin;
-- YouTube is an independent output from the same Cloudflare ingest.
alter table public.live_streams
  add column if not exists youtube_broadcast_id text,
  add column if not exists youtube_stream_id text,
  add column if not exists youtube_video_id text;

alter table public.live_streams drop constraint if exists live_streams_active_provider_check;
alter table public.live_streams add constraint live_streams_active_provider_check
  check (not is_live or tv_provider='cloudflare');

alter table public.live_streams drop constraint if exists live_streams_tv_provider_check;
alter table public.live_streams add constraint live_streams_tv_provider_check
  check (tv_provider in ('cloudflare','youtube','native-p2p'));

create index if not exists live_streams_youtube_broadcast_idx on public.live_streams(youtube_broadcast_id) where youtube_broadcast_id is not null;
create index if not exists live_streams_youtube_stream_idx on public.live_streams(youtube_stream_id) where youtube_stream_id is not null;
create index if not exists live_streams_youtube_video_idx on public.live_streams(youtube_video_id) where youtube_video_id is not null;

-- The browser only publishes once to Testagram/Cloudflare. YouTube is fanned out
-- from that same input, so no second browser encoder session is required.
drop table if exists public.tv_youtube_encoder_sessions;

notify pgrst,'reload schema';
