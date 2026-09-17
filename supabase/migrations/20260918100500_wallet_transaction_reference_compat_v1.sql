alter table public.wallet_transactions
  add column if not exists reference text generated always as (coalesce(provider_order_id, provider_reference)) stored;

create index if not exists wallet_transactions_user_reference_idx
  on public.wallet_transactions(user_id, reference)
  where reference is not null;
