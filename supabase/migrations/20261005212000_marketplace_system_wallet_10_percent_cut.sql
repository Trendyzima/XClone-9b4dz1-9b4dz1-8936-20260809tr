-- Marketplace delivery earnings are held by the platform System Wallet.
-- Withdrawal releases 90% to the courier Wallet and retains 10% as Testagram's platform fee.
create table if not exists public.system_wallets (
  currency text primary key,
  balance numeric not null default 0 check (balance >= 0),
  total_credits numeric not null default 0,
  total_platform_fees numeric not null default 0,
  total_released numeric not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.system_wallets enable row level security;
revoke all on public.system_wallets from public,anon,authenticated;

create table if not exists public.marketplace_delivery_earnings (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique references public.marketplace_deliveries(id) on delete restrict,
  courier_id uuid not null references auth.users(id) on delete restrict,
  gross_amount numeric not null check (gross_amount >= 0),
  platform_fee numeric not null check (platform_fee >= 0),
  net_amount numeric not null check (net_amount >= 0),
  currency text not null,
  status text not null default 'available' check (status in ('available','withdrawn','blocked')),
  withdrawal_transaction_id uuid,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.marketplace_delivery_earnings enable row level security;
revoke all on public.marketplace_delivery_earnings from public,anon,authenticated;
grant select on public.marketplace_delivery_earnings to authenticated;
drop policy if exists "couriers can read own delivery earnings" on public.marketplace_delivery_earnings;
create policy "couriers can read own delivery earnings" on public.marketplace_delivery_earnings
for select to authenticated using ((select auth.uid()) = courier_id);

create table if not exists public.system_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  entry_type text not null check (entry_type in ('delivery_earning_credit','platform_fee','courier_withdrawal')),
  amount numeric not null check (amount >= 0),
  courier_id uuid references auth.users(id) on delete set null,
  delivery_id uuid references public.marketplace_deliveries(id) on delete set null,
  earnings_id uuid references public.marketplace_delivery_earnings(id) on delete set null,
  wallet_transaction_id uuid,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
alter table public.system_wallet_ledger enable row level security;
revoke all on public.system_wallet_ledger from public,anon,authenticated;

create index if not exists marketplace_delivery_earnings_courier_status_idx on public.marketplace_delivery_earnings(courier_id,status,currency);
create index if not exists system_wallet_ledger_currency_created_idx on public.system_wallet_ledger(currency,created_at desc);

-- Keep the delivery-completion function aligned with the System Wallet model.
create or replace function public.confirm_marketplace_delivery(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare d public.marketplace_deliveries%rowtype; a public.marketplace_delivery_agents%rowtype;
  gross numeric; fee numeric; net numeric; currency_code text; earning_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into d from public.marketplace_deliveries where id=p_delivery_id and buyer_id=auth.uid() for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  if d.payment_status <> 'paid' then raise exception 'DELIVERY_PAYMENT_NOT_VERIFIED'; end if;
  if d.courier_id is null then raise exception 'COURIER_NOT_ASSIGNED'; end if;
  if d.status in ('delivered','cancelled') then return jsonb_build_object('ok',true,'already_complete',true,'payout_status',d.payout_status); end if;
  select * into a from public.marketplace_delivery_agents where user_id=d.courier_id for update;
  if not found then raise exception 'COURIER_NOT_ACTIVE'; end if;
  if not a.active and a.blocked_at is null then raise exception 'COURIER_NOT_ACTIVE'; end if;
  gross:=round(d.courier_payout_minor/100.0,2); fee:=round(gross*0.10,2); net:=gross-fee; currency_code:=upper(d.currency);

  update public.marketplace_deliveries set status='delivered',payout_status=case when a.blocked_at is not null then 'blocked' else 'pending' end,updated_at=now() where id=d.id;
  insert into public.marketplace_delivery_events(delivery_id,status,note) values(d.id,'delivered','Buyer confirmed delivery; platform payment verified');
  update public.orders set delivery_status='delivered',delivered_at=now(),updated_at=now() where id=d.order_id;
  if a.blocked_at is not null then return jsonb_build_object('ok',true,'payout_status','blocked','congratulations',false); end if;

  insert into public.system_wallets(currency,balance,total_credits,total_platform_fees,total_released)
  values(currency_code,gross,gross,0,0)
  on conflict(currency) do update set balance=system_wallets.balance+excluded.balance,total_credits=system_wallets.total_credits+excluded.total_credits,updated_at=now();

  insert into public.marketplace_delivery_earnings(delivery_id,courier_id,gross_amount,platform_fee,net_amount,currency,status,metadata)
  values(d.id,d.courier_id,gross,fee,net,currency_code,'available',jsonb_build_object('platform_fee_rate',0.10,'source','delivery_confirmation'))
  on conflict(delivery_id) do nothing returning id into earning_id;

  insert into public.system_wallet_ledger(currency,entry_type,amount,courier_id,delivery_id,earnings_id,idempotency_key,metadata)
  values(currency_code,'delivery_earning_credit',gross,d.courier_id,d.id,earning_id,'delivery-earning:'||d.id::text,jsonb_build_object('gross',gross,'platform_fee_rate',0.10))
  on conflict(idempotency_key) do nothing;
  update public.marketplace_deliveries set payout_status='pending',updated_at=now() where id=d.id;
  return jsonb_build_object('ok',true,'payout_status','pending','gross_amount',gross,'platform_fee',fee,'platform_fee_rate',0.10,'withdrawable_amount',net,'congratulations',true);
end
$function$;

create or replace function public.withdraw_marketplace_earnings()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare uid uuid:=auth.uid(); w public.wallets%rowtype; sw public.system_wallets%rowtype; e record;
  gross numeric:=0; fee numeric:=0; net numeric:=0; txid uuid; before_balance numeric; currency_code text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into w from public.wallets where user_id=uid::text for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if coalesce(w.withdrawals_enabled,false)=false then raise exception 'WITHDRAWALS_DISABLED'; end if;
  currency_code:=upper(coalesce(w.currency,w.preferred_currency,'KES'));
  select * into sw from public.system_wallets where currency=currency_code for update;
  if not found then raise exception 'NO_SYSTEM_EARNINGS'; end if;

  for e in select * from public.marketplace_delivery_earnings where courier_id=uid and status='available' and currency=currency_code order by created_at for update loop
    gross:=gross+e.gross_amount; fee:=fee+e.platform_fee; net:=net+e.net_amount;
  end loop;
  if gross<=0 then raise exception 'NO_WITHDRAWABLE_EARNINGS'; end if;
  if sw.balance<gross then raise exception 'SYSTEM_WALLET_BALANCE_MISMATCH'; end if;

  before_balance:=coalesce(w.balance,0);
  update public.system_wallets set balance=balance-gross,total_platform_fees=total_platform_fees+fee,total_released=total_released+net,updated_at=now() where currency=currency_code;
  update public.wallets set balance=balance+net,updated_at=now() where id=w.id;

  insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,provider_reference,provider_status,description,metadata,payment_method,reference,idempotency_key,completed_at,created_at,updated_at)
  values(w.id,uid::text,'delivery_earnings_withdrawal','delivery_earnings_withdrawal',net,round(net*100)::bigint,currency_code,'in','completed',before_balance,before_balance+net,'testagram_system_wallet','EARNINGS-'||gen_random_uuid()::text,'completed','Marketplace delivery earnings withdrawal',jsonb_build_object('gross',gross,'platform_fee',fee,'platform_fee_rate',0.10,'net',net),'wallet','delivery-earnings-withdrawal','delivery-earnings-withdrawal:'||uid::text||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),now(),now(),now())
  returning id into txid;

  update public.marketplace_delivery_earnings set status='withdrawn',withdrawal_transaction_id=txid,withdrawn_at=now() where courier_id=uid and status='available' and currency=currency_code;
  insert into public.system_wallet_ledger(currency,entry_type,amount,courier_id,wallet_transaction_id,idempotency_key,metadata) values(currency_code,'platform_fee',fee,uid,txid,'platform-fee:'||txid::text,jsonb_build_object('gross',gross,'fee_rate',0.10,'net',net)) on conflict(idempotency_key) do nothing;
  insert into public.system_wallet_ledger(currency,entry_type,amount,courier_id,wallet_transaction_id,idempotency_key,metadata) values(currency_code,'courier_withdrawal',net,uid,txid,'courier-withdrawal:'||txid::text,jsonb_build_object('gross',gross,'platform_fee',fee,'net',net)) on conflict(idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'gross_amount',gross,'platform_fee',fee,'platform_fee_rate',0.10,'net_amount',net,'currency',currency_code,'wallet_transaction_id',txid);
end
$function$;

revoke execute on function public.confirm_marketplace_delivery(uuid) from public,anon;
revoke execute on function public.withdraw_marketplace_earnings() from public,anon;
grant execute on function public.confirm_marketplace_delivery(uuid) to authenticated;
grant execute on function public.withdraw_marketplace_earnings() to authenticated;
