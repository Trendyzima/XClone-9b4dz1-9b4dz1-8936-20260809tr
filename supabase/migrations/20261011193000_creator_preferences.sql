-- Per-creator preferences are deliberately separate from monetization
-- eligibility and earnings ledgers. A user may only change their own goal.
create table if not exists public.creator_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_tip_goal numeric(20,6) not null default 0 check (monthly_tip_goal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creator_preferences enable row level security;

drop policy if exists creator_preferences_owner_read on public.creator_preferences;
create policy creator_preferences_owner_read
  on public.creator_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists creator_preferences_owner_insert on public.creator_preferences;
create policy creator_preferences_owner_insert
  on public.creator_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists creator_preferences_owner_update on public.creator_preferences;
create policy creator_preferences_owner_update
  on public.creator_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.creator_preferences to authenticated;
revoke all on public.creator_preferences from anon, public;
