-- Restore the authenticated CRUD contract for Threads.
-- The table is intentionally RLS-protected; without these policies, the dedicated
-- thread composer can authenticate successfully yet every INSERT/UPDATE is denied.
create policy "threads_public_read"
on public.threads
for select
to anon, authenticated
using (deleted_at is null and visibility = 'public');

create policy "threads_owner_insert"
on public.threads
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "threads_owner_update"
on public.threads
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "threads_owner_delete"
on public.threads
for delete
to authenticated
using (owner_id = auth.uid());

-- Keep the existing daily quota trigger authoritative. The trigger runs before
-- INSERT and rejects unauthenticated/over-quota creation.
