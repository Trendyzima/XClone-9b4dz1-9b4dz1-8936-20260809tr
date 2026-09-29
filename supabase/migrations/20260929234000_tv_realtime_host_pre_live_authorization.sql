-- Allow the TV host to authorize the private signaling channel before is_live flips true.
-- Realtime caches channel authorization at join time, so both read and write
-- permissions must include the stream owner during the pre-live handshake.
drop policy if exists "tv_realtime_receive" on realtime.messages;
create policy "tv_realtime_receive"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.live_streams s
    where ('tv:' || s.id::text) = realtime.topic()
      and (s.is_live = true or s.user_id = (select auth.uid()))
  )
);

drop policy if exists "tv_realtime_send" on realtime.messages;
create policy "tv_realtime_send"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.live_streams s
    where ('tv:' || s.id::text) = realtime.topic()
      and (s.is_live = true or s.user_id = (select auth.uid()))
  )
);

notify pgrst, 'reload schema';
