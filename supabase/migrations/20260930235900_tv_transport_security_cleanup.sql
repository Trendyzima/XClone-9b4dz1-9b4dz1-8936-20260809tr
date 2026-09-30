-- Testagram TV: remove stale native/YouTube live transport paths and lock active broadcasts to Mux.
-- Historical non-live provider values remain for auditability; only active broadcasts may use Mux.

-- A legacy native-p2p broadcast can survive as stale control-plane state after the
-- old transport was retired. It must not remain publicly live without a Mux stream.
update public.live_streams
set is_live = false,
    ended_at = coalesce(ended_at, now()),
    stream_url = null,
    tv_connection_state = 'offline',
    tv_last_heartbeat_at = null,
    tv_host_peer_id = null,
    viewer_count = 0
where is_live = true
  and tv_provider <> 'mux';

alter table public.live_streams
  drop constraint if exists live_streams_active_provider_check;

alter table public.live_streams
  add constraint live_streams_active_provider_check
  check (not is_live or tv_provider = 'mux');

-- The YouTube encoder-session table is no longer part of the TV transport.
drop table if exists public.tv_youtube_encoder_sessions;

-- Realtime signaling is only for the broadcaster and an authenticated, claimed
-- guest invite. Public viewers use Mux HLS and never need the signaling channel.
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
      and (
        s.user_id = (select auth.uid())
        or exists (
          select 1
          from public.tv_guest_invites i
          where i.stream_id = s.id
            and i.claimed_by = (select auth.uid())
            and i.used_at is not null
            and i.expires_at > now()
        )
      )
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
      and (
        s.user_id = (select auth.uid())
        or exists (
          select 1
          from public.tv_guest_invites i
          where i.stream_id = s.id
            and i.claimed_by = (select auth.uid())
            and i.used_at is not null
            and i.expires_at > now()
        )
      )
  )
);

notify pgrst, 'reload schema';
