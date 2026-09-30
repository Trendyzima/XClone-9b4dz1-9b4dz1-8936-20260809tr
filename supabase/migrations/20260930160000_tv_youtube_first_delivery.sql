-- Testagram TV: YouTube-first playback/control plane.
-- YouTube is a first-class live delivery provider. ON AIR is only valid after YouTube reports an active stream.

alter table public.live_streams
  add column if not exists youtube_broadcast_id text,
  add column if not exists youtube_stream_id text,
  add column if not exists youtube_video_id text;

alter table public.live_streams drop constraint if exists live_streams_active_provider_check;
alter table public.live_streams add constraint live_streams_active_provider_check
  check (not is_live or tv_provider in ('youtube','cloudflare','native-p2p'));

alter table public.live_streams drop constraint if exists live_streams_tv_provider_check;
alter table public.live_streams add constraint live_streams_tv_provider_check
  check (tv_provider in ('native-p2p','youtube','cloudflare'));

create index if not exists live_streams_youtube_broadcast_idx on public.live_streams(youtube_broadcast_id) where youtube_broadcast_id is not null;
create index if not exists live_streams_youtube_stream_idx on public.live_streams(youtube_stream_id) where youtube_stream_id is not null;
create index if not exists live_streams_youtube_video_idx on public.live_streams(youtube_video_id) where youtube_video_id is not null;

notify pgrst,'reload schema';
