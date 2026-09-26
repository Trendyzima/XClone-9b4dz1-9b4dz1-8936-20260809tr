-- Realtime discovery/control-plane events for ephemeral broadcasts.
alter publication supabase_realtime add table public.live_streams;
alter publication supabase_realtime add table public.stream_viewers;
