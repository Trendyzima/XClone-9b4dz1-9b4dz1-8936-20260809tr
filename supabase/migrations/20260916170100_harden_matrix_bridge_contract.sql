drop policy if exists "matrix_rooms_member_insert" on public.matrix_conversation_rooms;
create policy "matrix_rooms_member_insert" on public.matrix_conversation_rooms for insert to authenticated
with check (exists (select 1 from public.conversation_members cm where cm.conversation_id=matrix_conversation_rooms.conversation_id and cm.user_id=(select auth.uid())) and status in ('pending','active'));

drop policy if exists "matrix_rooms_member_update" on public.matrix_conversation_rooms;
create policy "matrix_rooms_member_update" on public.matrix_conversation_rooms for update to authenticated
using (exists (select 1 from public.conversation_members cm where cm.conversation_id=matrix_conversation_rooms.conversation_id and cm.user_id=(select auth.uid())))
with check (exists (select 1 from public.conversation_members cm where cm.conversation_id=matrix_conversation_rooms.conversation_id and cm.user_id=(select auth.uid())));

alter function public.upsert_matrix_identity(text,text) set search_path=public,pg_temp;
alter function public.create_domain_notification(uuid,text,uuid,text,text,jsonb,text) set search_path=public,pg_temp;
