-- Testagram financial account separation + double-entry ledger.
-- Applied to the production Supabase project on 2026-10-05.
-- User wallets remain the UI/compatibility projection; the ledger is the
-- accounting record for new money movements.

create table if not exists public.wallet_accounts (
 id uuid primary key default gen_random_uuid(),
 account_type text not null check (account_type in ('PLATFORM','USER','DRIVER_PAYABLE','MPESA_CLEARING','MPESA_COST_RESERVE')),
 user_id uuid references auth.users(id),
 currency text not null default 'KES' check (currency='KES'),
 status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','CLOSED')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists wallet_accounts_one_platform on public.wallet_accounts(account_type) where account_type='PLATFORM';
create unique index if not exists wallet_accounts_one_user on public.wallet_accounts(user_id) where account_type='USER' and user_id is not null;
create unique index if not exists wallet_accounts_one_driver_payable on public.wallet_accounts(user_id) where account_type='DRIVER_PAYABLE' and user_id is not null;

create table if not exists public.ledger_transactions (
 id uuid primary key default gen_random_uuid(),
 transaction_type text not null,
 reference_type text,
 reference_id uuid,
 idempotency_key text unique,
 status text not null default 'POSTED' check(status in ('PENDING','POSTED','VOID','REVERSED')),
 currency text not null default 'KES' check(currency='KES'),
 description text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.ledger_entries (
 id uuid primary key default gen_random_uuid(),
 transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
 account_id uuid not null references public.wallet_accounts(id) on delete restrict,
 direction text not null check(direction in ('DEBIT','CREDIT')),
 amount_minor bigint not null check(amount_minor>0),
 currency text not null default 'KES' check(currency='KES'),
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.driver_payouts (
 id uuid primary key default gen_random_uuid(),
 driver_user_id uuid not null references auth.users(id),
 ride_id uuid,
 payable_amount_minor bigint not null check(payable_amount_minor>0),
 currency text not null default 'KES',
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','SUBMITTED','PROCESSING','PAID','FAILED','REVERSED')),
 provider text default 'MPESA_B2C',
 provider_reference text,
 failure_reason text,
 idempotency_key text unique not null,
 submitted_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

alter table public.rides add column if not exists driver_id uuid references auth.users(id);
create index if not exists rides_driver_id_idx on public.rides(driver_id);

insert into public.wallet_accounts(account_type) values
 ('PLATFORM'),('MPESA_CLEARING'),('MPESA_COST_RESERVE')
on conflict do nothing;

insert into public.wallet_accounts(account_type,user_id)
select 'USER',id from auth.users
on conflict do nothing;
insert into public.wallet_accounts(account_type,user_id)
select 'DRIVER_PAYABLE',id from auth.users
on conflict do nothing;

alter table public.wallet_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.driver_payouts enable row level security;

create or replace view public.wallet_account_balances with (security_invoker=true) as
select wa.id,wa.account_type,wa.user_id,wa.currency,wa.status,
coalesce(sum(case when le.direction='CREDIT' then le.amount_minor else -le.amount_minor end),0)::bigint balance_minor,
(coalesce(sum(case when le.direction='CREDIT' then le.amount_minor else -le.amount_minor end),0)/100.0)::numeric balance_kes
from public.wallet_accounts wa
left join public.ledger_entries le on le.account_id=wa.id
group by wa.id,wa.account_type,wa.user_id,wa.currency,wa.status;

-- All ledger writes go through SECURITY DEFINER server-side functions.
-- Direct table access is denied to client roles.
revoke all on public.wallet_accounts,public.ledger_transactions,public.ledger_entries,public.driver_payouts from anon,authenticated;

create or replace function public.get_user_wallet_summary()
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object(
   'ok',true,
   'account_id',id,
   'balance_kes',balance_kes,
   'currency',currency,
   'status',status
 ) from public.wallet_account_balances
 where account_type='USER' and user_id=auth.uid()
 $$;
revoke all on function public.get_user_wallet_summary() from public,anon;
grant execute on function public.get_user_wallet_summary() to authenticated;

-- Ride settlement invariant:
-- rider DEBIT = driver payable CREDIT + platform revenue CREDIT + M-PESA reserve CREDIT.
-- The live implementation also records the same transaction in wallet_transactions
-- for UI compatibility and creates a PENDING driver_payout record.
