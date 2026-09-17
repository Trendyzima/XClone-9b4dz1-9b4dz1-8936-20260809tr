-- Production-applied E2EE RLS hardening migration.
drop policy if exists communication_devices_select_conversation_members on public.communication_devices;
create policy communication_devices_select_conversation_members on public.communication_devices for select to authenticated using(user_id in(select private.communication_visible_user_ids()));
drop policy if exists communication_devices_insert_own on public.communication_devices;
create policy communication_devices_insert_own on public.communication_devices for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists communication_devices_update_own on public.communication_devices;
create policy communication_devices_update_own on public.communication_devices for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists communication_key_envelopes_select_recipient on public.communication_key_envelopes;
create policy communication_key_envelopes_select_recipient on public.communication_key_envelopes for select to authenticated using(exists(select 1 from public.communication_devices d where d.id=recipient_device_id and d.user_id=(select auth.uid()) and d.revoked_at is null));
revoke insert,update,delete on public.communication_key_envelopes from authenticated;
revoke all on public.communication_key_envelopes from anon;
