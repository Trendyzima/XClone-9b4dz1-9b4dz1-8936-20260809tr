-- Keep live chat on Supabase Realtime instead of per-viewer polling.
alter publication supabase_realtime add table public.stream_chat;
