-- Testagram TV: YouTube passive-viewer distribution metadata.
-- YouTube is an optional downstream destination fed by the existing Cloudflare
-- live input. It does not replace the Supabase TV control plane.
alter table public.live_streams
  add column if not exists youtube_broadcast_id text,
  add column if not exists youtube_stream_id text,
  add column if not exists youtube_output_id text;

create index if not exists live_streams_youtube_broadcast_idx
  on public.live_streams(youtube_broadcast_id)
  where youtube_broadcast_id is not null;

create index if not exists live_streams_youtube_stream_idx
  on public.live_streams(youtube_stream_id)
  where youtube_stream_id is not null;

notify pgrst, 'reload schema';
