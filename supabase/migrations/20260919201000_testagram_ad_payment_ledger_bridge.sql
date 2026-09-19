-- Complete Testagram Ads payment ledger bridge.
create table if not exists public.testagram_ad_payments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
 wallet_id uuid references public.wallets(id) on delete set null, wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
 mpesa_payment_id uuid references public.mpesa_payments(id) on delete set null, amount_kes numeric(12,2) not null check(amount_kes>=10), phone text not null,
 merchant_request_id text, checkout_request_id text, mpesa_receipt_number text,
 status text not null default 'pending', result_code integer, result_description text,
 callback_data jsonb not null default '{}', provider_response jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists testagram_ad_payments_checkout_uidx on public.testagram_ad_payments(checkout_request_id) where checkout_request_id is not null;
create unique index if not exists testagram_ad_payments_pending_campaign_user_key on public.testagram_ad_payments(campaign_id,user_id) where status='pending';
alter table public.testagram_ad_payments enable row level security;
drop policy if exists testagram_ad_payments_owner_select on public.testagram_ad_payments;
create policy testagram_ad_payments_owner_select on public.testagram_ad_payments for select to authenticated using(user_id=(select auth.uid()));
