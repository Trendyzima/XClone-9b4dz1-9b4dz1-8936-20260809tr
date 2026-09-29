-- Testagram TV now uses Supabase Edge control + Realtime signaling + browser WebRTC.
-- Retire provider-specific TV metadata that belonged to Cloudflare/Mux/YouTube.
create table if not exists public.tv_guest_invites (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tv_guest_invites_stream_idx on public.tv_guest_invites(stream_id, expires_at desc);
alter table public.tv_guest_invites enable row level security;
drop policy if exists "tv_guest_invites_owner_read" on public.tv_guest_invites;
create policy "tv_guest_invites_owner_read" on public.tv_guest_invites
  for select to authenticated
  using (exists (select 1 from public.live_streams s where s.id=stream_id and s.user_id=auth.uid()));
grant select on public.tv_guest_invites to authenticated;

alter table public.live_streams
  drop column if exists mux_live_stream_id,
  drop column if exists mux_playback_id,
  drop column if exists cloudflare_input_id,
  drop column if exists cloudflare_output_id,
  drop column if exists youtube_broadcast_id,
  drop column if exists youtube_stream_id,
  drop column if exists youtube_output_id;

drop index if exists public.live_streams_mux_live_stream_idx;
drop index if exists public.live_streams_cloudflare_input_idx;
drop index if exists public.live_streams_youtube_broadcast_idx;
drop index if exists public.live_streams_youtube_stream_idx;

notify pgrst, 'reload schema';
