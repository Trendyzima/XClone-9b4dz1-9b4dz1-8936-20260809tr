alter table public.live_streams add column if not exists tv_provider text not null default 'native-p2p';
alter table public.live_streams add column if not exists youtube_broadcast_id text;
alter table public.live_streams add column if not exists youtube_stream_id text;
alter table public.live_streams add column if not exists youtube_video_id text;

alter table public.live_streams drop constraint if exists live_streams_tv_provider_check;
alter table public.live_streams add constraint live_streams_tv_provider_check check (tv_provider in ('native-p2p','youtube'));

create index if not exists live_streams_youtube_broadcast_id_idx on public.live_streams(youtube_broadcast_id) where youtube_broadcast_id is not null;
create index if not exists live_streams_youtube_video_id_idx on public.live_streams(youtube_video_id) where youtube_video_id is not null;

notify pgrst, 'reload schema';
