-- Testagram TV: first-class YouTube downstream distribution through the Mux simulcast path.
-- Mux remains the primary Testagram playback transport; YouTube receives the same
-- encoded program through a Mux RTMP simulcast target.
alter table public.live_streams
  add column if not exists youtube_simulcast_target_id text,
  add column if not exists youtube_status text not null default 'disabled',
  add column if not exists youtube_error text;

create index if not exists live_streams_youtube_simulcast_idx
  on public.live_streams(youtube_simulcast_target_id)
  where youtube_simulcast_target_id is not null;

notify pgrst, 'reload schema';
