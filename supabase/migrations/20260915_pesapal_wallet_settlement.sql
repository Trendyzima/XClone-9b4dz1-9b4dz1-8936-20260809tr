create table if not exists public.pesapal_payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_reference text not null unique,
  order_tracking_id text unique,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'KES',
  description text not null,
  callback_url text not null,
  cancellation_url text,
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED','FAILED','CANCELLED','INVALID')),
  provider_status_code text,
  provider_status_description text,
  redirect_url text,
  raw_submit_response jsonb,
  raw_status_response jsonb,
  ipn_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pesapal_payment_orders
  add column if not exists wallet_id uuid,
  add column if not exists wallet_transaction_id uuid,
  add column if not exists wallet_amount numeric(14,2),
  add column if not exists wallet_currency text;

DO $$
BEGIN
  IF NOT EXISTS (select 1 from pg_constraint where conname='pesapal_orders_wallet_fk') THEN
    alter table public.pesapal_payment_orders add constraint pesapal_orders_wallet_fk foreign key (wallet_id) references public.wallets(id) on delete set null;
  END IF;
  IF NOT EXISTS (select 1 from pg_constraint where conname='pesapal_orders_wallet_tx_fk') THEN
    alter table public.pesapal_payment_orders add constraint pesapal_orders_wallet_tx_fk foreign key (wallet_transaction_id) references public.wallet_transactions(id) on delete set null;
  END IF;
END $$;

create index if not exists pesapal_payment_orders_user_idx on public.pesapal_payment_orders(user_id, created_at desc);
create index if not exists pesapal_payment_orders_tracking_idx on public.pesapal_payment_orders(order_tracking_id);
create unique index if not exists pesapal_orders_wallet_tx_unique on public.pesapal_payment_orders(wallet_transaction_id) where wallet_transaction_id is not null;

alter table public.pesapal_payment_orders enable row level security;

DO $$
BEGIN
  IF NOT EXISTS (select 1 from pg_policies where schemaname='public' and tablename='pesapal_payment_orders' and policyname='pesapal_orders_owner_select') THEN
    create policy pesapal_orders_owner_select on public.pesapal_payment_orders for select using (auth.uid() = user_id);
  END IF;
END $$;

create or replace function public.finalize_pesapal_payment_order(
  p_merchant_reference text,
  p_provider_status_code text,
  p_provider_status_description text default null,
  p_status_response jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.pesapal_payment_orders;
  v_tx public.wallet_transactions;
  v_wallet public.wallets;
  v_before numeric;
  v_after numeric;
  v_amount numeric;
  v_currency text;
  v_provider_amount numeric;
  v_provider_currency text;
  v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  if nullif(btrim(p_merchant_reference), '') is null then raise exception 'merchant_reference_required' using errcode='22023'; end if;

  select * into v_order from public.pesapal_payment_orders where merchant_reference=p_merchant_reference for update;
  if not found then raise exception 'pesapal_order_not_found' using errcode='P0002'; end if;

  v_status := case when p_provider_status_code='1' then 'COMPLETED' when p_provider_status_code='2' then 'FAILED' when p_provider_status_code='3' then 'CANCELLED' when p_provider_status_code='0' then 'INVALID' else 'PENDING' end;

  if v_status <> 'COMPLETED' then
    update public.pesapal_payment_orders set status=v_status,provider_status_code=p_provider_status_code,provider_status_description=p_provider_status_description,raw_status_response=coalesce(p_status_response,'{}'::jsonb),updated_at=now() where id=v_order.id and status <> 'COMPLETED';
    if v_order.wallet_transaction_id is not null and v_status in ('FAILED','CANCELLED','INVALID') then
      update public.wallet_transactions set status='failed',provider_status=coalesce(p_provider_status_description,p_provider_status_code) where id=v_order.wallet_transaction_id and status='pending';
    end if;
    return jsonb_build_object('ok',true,'status',v_status,'merchant_reference',v_order.merchant_reference);
  end if;

  if v_order.status='COMPLETED' then return jsonb_build_object('ok',true,'idempotent',true,'status','COMPLETED','merchant_reference',v_order.merchant_reference); end if;
  if v_order.wallet_transaction_id is null or v_order.wallet_id is null then raise exception 'pesapal_wallet_settlement_not_initialized' using errcode='23514'; end if;

  v_provider_amount := nullif(p_status_response->>'amount','')::numeric;
  v_provider_currency := upper(nullif(p_status_response->>'currency',''));
  if v_provider_amount is not null and abs(v_provider_amount-v_order.amount)>0.005 then raise exception 'pesapal_amount_mismatch' using errcode='22000'; end if;
  if v_provider_currency is not null and v_provider_currency<>upper(v_order.currency) then raise exception 'pesapal_currency_mismatch' using errcode='22000'; end if;

  select * into v_tx from public.wallet_transactions where id=v_order.wallet_transaction_id for update;
  if not found then raise exception 'wallet_transaction_not_found' using errcode='P0002'; end if;
  if v_tx.status='completed' then
    update public.pesapal_payment_orders set status='COMPLETED',provider_status_code=p_provider_status_code,provider_status_description=p_provider_status_description,raw_status_response=coalesce(p_status_response,'{}'::jsonb),paid_at=coalesce(paid_at,now()),updated_at=now() where id=v_order.id;
    return jsonb_build_object('ok',true,'idempotent',true,'status','COMPLETED','merchant_reference',v_order.merchant_reference);
  end if;
  if v_tx.status<>'pending' then raise exception 'wallet_transaction_not_pending' using errcode='23514'; end if;

  select * into v_wallet from public.wallets where id=v_order.wallet_id and user_id=v_order.user_id for update;
  if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
  if upper(coalesce(v_wallet.currency,'USD'))<>upper(v_order.currency) then raise exception 'wallet_currency_mismatch' using errcode='22000'; end if;

  v_amount:=coalesce(v_order.wallet_amount,v_order.amount);
  v_currency:=upper(coalesce(v_order.wallet_currency,v_order.currency));
  v_before:=coalesce(v_wallet.balance,0);
  v_after:=v_before+v_amount;
  update public.wallets set balance=v_after,total_deposited=coalesce(total_deposited,0)+v_amount,updated_at=now() where id=v_wallet.id;
  update public.wallet_transactions set status='completed',balance_before=v_before,balance_after=v_after,provider='pesapal',provider_status=coalesce(p_provider_status_description,p_provider_status_code),payment_method=coalesce(p_status_response->>'payment_method','pesapal'),provider_capture_id=coalesce(p_status_response->>'confirmation_code',provider_capture_id),completed_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('pesapal_merchant_reference',v_order.merchant_reference,'pesapal_status',p_status_response) where id=v_tx.id;
  update public.pesapal_payment_orders set status='COMPLETED',provider_status_code=p_provider_status_code,provider_status_description=p_provider_status_description,raw_status_response=coalesce(p_status_response,'{}'::jsonb),paid_at=now(),updated_at=now() where id=v_order.id;

  return jsonb_build_object('ok',true,'idempotent',false,'status','COMPLETED','merchant_reference',v_order.merchant_reference,'wallet_id',v_wallet.id,'amount',v_amount,'currency',v_currency,'balance_before',v_before,'balance_after',v_after);
end;
$function$;