-- Marketplace delivery + wallet checkout hardening.
alter table public.products add column if not exists local_delivery boolean not null default false;
alter table public.products add column if not exists delivery_fee_minor bigint not null default 0;
alter table public.products add column if not exists delivery_eta text;
alter table public.orders add column if not exists delivery_mode text not null default 'seller_delivery';
alter table public.orders add column if not exists delivery_fee_minor bigint not null default 0;
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists delivery_note text;
alter table public.orders add column if not exists delivery_status text not null default 'pending';
do $$ begin alter table public.products add constraint products_delivery_fee_minor_check check (delivery_fee_minor >= 0); exception when duplicate_object then null; end $$;
do $$ begin alter table public.orders add constraint orders_delivery_fee_minor_check check (delivery_fee_minor >= 0); exception when duplicate_object then null; end $$;
do $$ begin alter table public.products add constraint products_delivery_eta_length_check check (delivery_eta is null or char_length(delivery_eta) <= 120); exception when duplicate_object then null; end $$;

-- The live function is the source of truth for wallet checkout: stock decrement,
-- buyer debit, seller credit, order creation and ledger entries commit atomically.
-- UI passes delivery mode/address/note into this function.
