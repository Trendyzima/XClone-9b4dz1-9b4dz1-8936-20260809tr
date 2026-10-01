-- Production repair for community membership RLS recursion.
-- The prior forensic migration is already recorded in production, so this is
-- intentionally a new migration and is the authoritative runtime repair.

create or replace function public.community_membership_is_active(
  p_community_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
  );
$$;

revoke execute on function public.community_membership_is_active(uuid, uuid) from public, anon;
grant execute on function public.community_membership_is_active(uuid, uuid) to authenticated;

-- Remove every legacy community_members policy. Any policy that queries
-- community_members from a community_members policy can recursively invoke RLS.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'community_members'
  loop
    execute format(
      'drop policy if exists %I on public.community_members',
      p.policyname
    );
  end loop;
end
$$;

alter table public.community_members enable row level security;

create policy "community members self or community read"
on public.community_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.community_membership_is_active(
    community_id,
    (select auth.uid())
  )
);

create policy "community members own join"
on public.community_members
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'member'
  and status in ('active', 'pending')
);

-- Keep membership mutations server-authoritative.
revoke insert, update, delete on public.community_members from authenticated;
grant select on public.community_members to authenticated;

-- Defense in depth: the client-facing join operation must remain callable,
-- but the table itself must not become a writable authorization surface.
revoke execute on function public.community_membership_is_active(uuid, uuid) from anon;
