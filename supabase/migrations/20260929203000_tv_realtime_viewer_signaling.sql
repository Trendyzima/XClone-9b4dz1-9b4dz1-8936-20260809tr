-- TV native WebRTC signaling: authenticated viewers must be able to send
-- join/answer/candidate/reconnect messages to a live stream topic.
-- This carries signaling metadata only; media never enters Realtime.
drop policy if exists "tv_realtime_send" on realtime.messages;

create policy "tv_realtime_send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.live_streams s
      where ('tv:' || s.id::text) = realtime.topic()
        and s.is_live = true
    )
  );

notify pgrst, 'reload schema';
