create unique index if not exists wallet_accounts_one_mpesa_clearing_currency on public.wallet_accounts(account_type,currency) where account_type='MPESA_CLEARING';
create unique index if not exists wallet_accounts_one_mpesa_cost_reserve_currency on public.wallet_accounts(account_type,currency) where account_type='MPESA_COST_RESERVE';
