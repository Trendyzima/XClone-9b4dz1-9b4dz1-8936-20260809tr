-- Wallet + monetization production boundary v3
-- Monetary balances and payout state are server-controlled. Browser clients may
-- read their own state but cannot mutate canonical balances or payout records.

revoke update on public.wallets from authenticated;
revoke insert on public.wallets from authenticated;
revoke delete on public.wallets from authenticated;

drop policy if exists wallets_own_update on public.wallets;

drop policy if exists payout_accounts_owner on public.payout_accounts;
drop policy if exists payouts_owner on public.payouts;

create policy payout_accounts_owner_select
  on public.payout_accounts
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy payout_accounts_owner_insert
  on public.payout_accounts
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
  );

create policy payouts_owner_select
  on public.payouts
  for select to authenticated
  using ((select auth.uid()) = user_id);

alter table public.wallets
  drop constraint if exists wallets_balance_nonnegative,
  drop constraint if exists wallets_totals_nonnegative;

alter table public.wallets
  add constraint wallets_balance_nonnegative check (balance >= 0),
  add constraint wallets_totals_nonnegative check (
    coalesce(total_deposited,0) >= 0 and coalesce(total_withdrawn,0) >= 0
  );

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_amount_nonnegative;

alter table public.wallet_transactions
  add constraint wallet_transactions_amount_nonnegative check (amount >= 0);

create index if not exists wallet_transactions_user_created_idx
  on public.wallet_transactions(user_id, created_at desc);

create index if not exists wallet_transactions_wallet_created_idx
  on public.wallet_transactions(wallet_id, created_at desc);

create index if not exists creator_earnings_creator_created_idx
  on public.creator_earnings(creator_id, created_at desc);

create index if not exists creator_earnings_status_created_idx
  on public.creator_earnings(status, created_at desc);

create index if not exists payouts_user_created_idx
  on public.payouts(user_id, created_at desc);

create index if not exists payouts_status_updated_idx
  on public.payouts(status, updated_at desc);

create unique index if not exists payouts_provider_reference_uidx
  on public.payouts(provider, provider_reference)
  where provider_reference is not null;

create index if not exists payout_accounts_user_status_idx
  on public.payout_accounts(user_id, status, created_at desc);
