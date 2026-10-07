-- Retire external TV media state from the active schema.
-- Historical migrations remain for auditability; these columns/tables are no longer used by runtime code.

alter table public.live_streams drop column if exists youtube_broadcast_id;
alter table public.live_streams drop column if exists youtube_stream_id;
alter table public.live_streams drop column if exists youtube_video_id;
alter table public.live_streams drop column if exists youtube_output_id;
alter table public.live_streams drop column if exists youtube_status;
alter table public.live_streams drop column if exists youtube_error;
alter table public.live_streams drop column if exists cloudflare_input_id;
alter table public.live_streams drop column if exists cloudflare_output_id;
alter table public.live_streams drop column if exists cloudflare_video_id;
alter table public.live_streams drop column if exists cloudflare_playback_url;

drop table if exists public.tv_youtube_encoder_sessions;
drop table if exists public.tv_cloudflare_encoder_sessions;
drop table if exists public.tv_mux_encoder_sessions;
drop table if exists public.tv_youtube_encoder_sessions;

alter table public.live_streams drop constraint if exists live_streams_active_provider_check;
alter table public.live_streams drop constraint if exists live_streams_tv_provider_check;

alter table public.live_streams
  add constraint live_streams_active_provider_check
  check (not is_live or tv_provider='bunny');

alter table public.live_streams
  add constraint live_streams_tv_provider_check
  check (tv_provider in ('bunny','native-p2p'));

notify pgrst,'reload schema';
