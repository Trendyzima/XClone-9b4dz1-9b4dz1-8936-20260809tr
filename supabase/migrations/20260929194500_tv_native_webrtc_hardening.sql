-- Harden Testagram TV native WebRTC control and Realtime signaling.
-- Media stays browser-to-browser; Supabase owns authorization, lifecycle and signaling.

alter table public.tv_guest_invites
  add column if not exists claimed_by uuid references auth.users(id) on delete set null,
  add column if not exists claimed_at timestamptz;

alter table public.live_streams
  add column if not exists tv_last_heartbeat_at timestamptz,
  add column if not exists tv_connection_state text not null default 'offline',
  add column if not exists tv_host_peer_id text;

create index if not exists tv_guest_invites_claimed_by_idx
  on public.tv_guest_invites(claimed_by)
  where claimed_by is not null;

alter table public.live_streams
  drop constraint if exists live_streams_tv_connection_state_check;

alter table public.live_streams
  add constraint live_streams_tv_connection_state_check
  check (tv_connection_state in ('offline','starting','connected','degraded','stale'));

drop policy if exists "tv_guest_invites_claimed_read" on public.tv_guest_invites;
create policy "tv_guest_invites_claimed_read" on public.tv_guest_invites
  for select to authenticated
  using (claimed_by = (select auth.uid()));

drop policy if exists "tv_realtime_receive" on realtime.messages;
create policy "tv_realtime_receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.live_streams s
      where ('tv:' || s.id::text) = realtime.topic()
        and s.is_live = true
    )
  );

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
        and (
          s.user_id = (select auth.uid())
          or exists (
            select 1
            from public.tv_guest_invites i
            where i.stream_id = s.id
              and i.claimed_by = (select auth.uid())
              and i.used_at is not null
          )
        )
    )
  );

grant select on public.live_streams to authenticated, anon;
grant select, insert on public.tv_guest_invites to authenticated;

notify pgrst, 'reload schema';
