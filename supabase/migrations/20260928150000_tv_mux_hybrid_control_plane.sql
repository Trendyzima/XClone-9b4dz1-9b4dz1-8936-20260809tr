-- Testagram TV only: downstream Mux metadata for the Cloudflare -> Mux hybrid path.
-- Existing Supabase, Cloudflare, chat, and non-TV media contracts remain unchanged.
alter table public.live_streams
  add column if not exists mux_live_stream_id text,
  add column if not exists mux_playback_id text,
  add column if not exists cloudflare_input_id text,
  add column if not exists cloudflare_output_id text;

create index if not exists live_streams_mux_live_stream_idx
  on public.live_streams(mux_live_stream_id)
  where mux_live_stream_id is not null;

create index if not exists live_streams_cloudflare_input_idx
  on public.live_streams(cloudflare_input_id)
  where cloudflare_input_id is not null;

notify pgrst, 'reload schema';
