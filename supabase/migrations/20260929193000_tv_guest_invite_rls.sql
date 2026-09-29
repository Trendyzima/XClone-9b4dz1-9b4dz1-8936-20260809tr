drop policy if exists "tv_guest_invites_owner_insert" on public.tv_guest_invites;
create policy "tv_guest_invites_owner_insert" on public.tv_guest_invites
  for insert to authenticated
  with check (exists (select 1 from public.live_streams s where s.id=stream_id and s.user_id=auth.uid()));