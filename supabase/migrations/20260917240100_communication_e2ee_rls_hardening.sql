create schema if not exists private;

create or replace function private.communication_visible_user_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select distinct cm2.user_id
  from public.conversation_members cm1
  join public.conversation_members cm2 on cm2.conversation_id=cm1.conversation_id
  where cm1.user_id=(select auth.uid())
$$;

revoke all on function private.communication_visible_user_ids() from public;
grant usage on schema private to authenticated;
grant execute on function private.communication_visible_user_ids() to authenticated;

drop policy if exists communication_devices_select_conversation_members on public.communication_devices;
create policy communication_devices_select_conversation_members on public.communication_devices
for select to authenticated
using (user_id in (select private.communication_visible_user_ids()));

-- Keep direct table writes constrained to the authenticated user's own device identity.
drop policy if exists communication_devices_insert_own on public.communication_devices;
create policy communication_devices_insert_own on public.communication_devices
for insert to authenticated
with check (user_id=(select auth.uid()));
drop policy if exists communication_devices_update_own on public.communication_devices;
create policy communication_devices_update_own on public.communication_devices
for update to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

-- Envelopes are only readable by their recipient device and are written through the capability RPC.
drop policy if exists communication_key_envelopes_insert_authenticated on public.communication_key_envelopes;
drop policy if exists communication_key_envelopes_select_recipient on public.communication_key_envelopes;
create policy communication_key_envelopes_select_recipient on public.communication_key_envelopes
for select to authenticated
using (exists (select 1 from public.communication_devices d where d.id=recipient_device_id and d.user_id=(select auth.uid()) and d.revoked_at is null));
revoke insert, update, delete on public.communication_key_envelopes from authenticated;
revoke all on public.communication_key_envelopes from anon;

-- Prevent accidental direct plaintext reads/writes through the Data API on E2EE rows.
revoke update on public.messages from authenticated;
