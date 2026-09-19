-- Dynamic wallet alert preferences.
-- Values are user-owned and exposed only to the authenticated owner.
create table if not exists public.wallet_alert_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  withdrawal_threshold_usd numeric(18,2) not null default 10 check (withdrawal_threshold_usd > 0),
  daily_budget_usd numeric(18,2) not null default 50 check (daily_budget_usd > 0),
  updated_at timestamptz not null default now()
);

alter table public.wallet_alert_preferences enable row level security;

grant select, insert, update on public.wallet_alert_preferences to authenticated;

drop policy if exists wallet_alert_preferences_select_own on public.wallet_alert_preferences;
create policy wallet_alert_preferences_select_own
  on public.wallet_alert_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists wallet_alert_preferences_insert_own on public.wallet_alert_preferences;
create policy wallet_alert_preferences_insert_own
  on public.wallet_alert_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists wallet_alert_preferences_update_own on public.wallet_alert_preferences;
create policy wallet_alert_preferences_update_own
  on public.wallet_alert_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.wallet_alert_preferences is
  'Persistent per-user wallet spending alert settings; thresholds are display/ledger USD units.';
