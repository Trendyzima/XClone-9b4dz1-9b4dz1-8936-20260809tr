-- Compatibility bridge for the existing AdminPanel.tsx while the new platform RBAC becomes the canonical authorization plane.
-- This table is intentionally owner-only and must not become the long-term role authority.
create table if not exists public.admin_users (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

insert into public.admin_users(user_id)
select owner_user_id from public.platform_control where singleton=true
on conflict (user_id) do nothing;

alter table public.admin_users enable row level security;
drop policy if exists admin_users_owner_read on public.admin_users;
create policy admin_users_owner_read on public.admin_users
for select to authenticated using (user_id=auth.uid());

drop policy if exists admin_users_owner_write on public.admin_users;
create policy admin_users_owner_write on public.admin_users
for all to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());

comment on table public.admin_users is 'Temporary compatibility table for legacy AdminPanel. Canonical authorization is platform_role_assignments/platform_feature_assignments.';
