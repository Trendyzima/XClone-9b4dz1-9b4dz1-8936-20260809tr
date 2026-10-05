-- Marketplace delivery payment enforcement and courier fraud controls.
-- Every delivery must originate from a platform-verified Wallet checkout.
-- Completion is buyer-confirmed; courier payout is released only from the
-- platform delivery-fee ledger. Off-platform/cash/bypass reports immediately
-- suspend the courier and block pending payouts.

alter table public.marketplace_delivery_agents
  add column if not exists risk_score integer not null default 0,
  add column if not exists violation_count integer not null default 0,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists last_violation_at timestamptz;

alter table public.marketplace_deliveries
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_transaction_id uuid,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists platform_fee_minor bigint not null default 0,
  add column if not exists courier_payout_minor bigint not null default 0,
  add column if not exists payout_status text not null default 'pending',
  add column if not exists payout_transaction_id uuid;

alter table public.marketplace_deliveries
  drop constraint if exists marketplace_deliveries_payment_status_check;
alter table public.marketplace_deliveries
  add constraint marketplace_deliveries_payment_status_check
  check (payment_status in ('pending','paid','failed','refunded'));

alter table public.marketplace_deliveries
  drop constraint if exists marketplace_deliveries_payout_status_check;
alter table public.marketplace_deliveries
  add constraint marketplace_deliveries_payout_status_check
  check (payout_status in ('pending','paid','blocked'));

create table if not exists public.marketplace_delivery_platform_ledger (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.marketplace_deliveries(id) on delete cascade,
  entry_type text not null check (entry_type in ('delivery_fee_credit','courier_payout_debit','platform_fee_credit','adjustment')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  courier_id uuid,
  wallet_transaction_id uuid,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(delivery_id, entry_type)
);
alter table public.marketplace_delivery_platform_ledger enable row level security;
revoke all on public.marketplace_delivery_platform_ledger from anon, authenticated;
grant select on public.marketplace_delivery_platform_ledger to authenticated;
drop policy if exists "participants can read delivery ledger" on public.marketplace_delivery_platform_ledger;
create policy "participants can read delivery ledger"
on public.marketplace_delivery_platform_ledger
for select to authenticated
using (
  exists (
    select 1 from public.marketplace_deliveries d
    where d.id = delivery_id
      and ((select auth.uid()) = d.buyer_id or (select auth.uid()) = d.seller_id or (select auth.uid()) = d.courier_id)
  )
);

create table if not exists public.marketplace_delivery_violations (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.marketplace_deliveries(id) on delete cascade,
  courier_id uuid not null references auth.users(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  violation_type text not null check (violation_type in ('off_platform_payment','cash_collection','bypass_platform','fake_completion','other')),
  severity integer not null default 100 check (severity between 1 and 100),
  evidence text,
  created_at timestamptz not null default now()
);
alter table public.marketplace_delivery_violations enable row level security;
revoke all on public.marketplace_delivery_violations from anon, authenticated;
grant select, insert on public.marketplace_delivery_violations to authenticated;
drop policy if exists "participants can report delivery violations" on public.marketplace_delivery_violations;
create policy "participants can report delivery violations"
on public.marketplace_delivery_violations
for insert to authenticated
with check (
  (select auth.uid()) = reporter_id
  and exists (
    select 1 from public.marketplace_deliveries d
    where d.id = delivery_id
      and ((select auth.uid()) = d.buyer_id or (select auth.uid()) = d.seller_id)
      and d.courier_id = courier_id
  )
);
drop policy if exists "participants can read delivery violations" on public.marketplace_delivery_violations;
create policy "participants can read delivery violations"
on public.marketplace_delivery_violations
for select to authenticated
using (
  (select auth.uid()) = reporter_id
  or (select auth.uid()) = courier_id
  or exists (
    select 1 from public.marketplace_deliveries d
    where d.id = delivery_id
      and ((select auth.uid()) = d.buyer_id or (select auth.uid()) = d.seller_id)
  )
);

create index if not exists marketplace_delivery_agents_risk_idx
  on public.marketplace_delivery_agents(blocked_at, risk_score, violation_count);
create index if not exists marketplace_delivery_violations_courier_created_idx
  on public.marketplace_delivery_violations(courier_id, created_at desc);

create or replace function public.create_marketplace_delivery(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_order public.orders%rowtype;
  v_id uuid;
  v_tx_id uuid;
  v_fee bigint;
  v_currency text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_order from public.orders where id=p_order_id and buyer_id=auth.uid() for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.delivery_mode='pickup' then raise exception 'DELIVERY_NOT_REQUIRED'; end if;
  if v_order.delivery_address is null then raise exception 'DELIVERY_ADDRESS_REQUIRED'; end if;
  if v_order.paid_at is null or v_order.payment_method <> 'wallet' then raise exception 'DELIVERY_PAYMENT_REQUIRED'; end if;

  select wt.id into v_tx_id
  from public.wallet_transactions wt
  where wt.user_id=v_order.buyer_id::text
    and wt.kind='purchase' and wt.direction='out' and wt.status='completed'
    and wt.metadata->>'order_id'=v_order.id::text
  order by wt.created_at desc limit 1;
  if v_tx_id is null then raise exception 'PLATFORM_PAYMENT_NOT_VERIFIED'; end if;

  v_fee:=coalesce(v_order.delivery_fee_minor,0);
  v_currency:=upper(coalesce(v_order.currency,'KES'));

  insert into public.marketplace_deliveries(
    order_id,buyer_id,seller_id,status,pickup_address,dropoff_address,
    delivery_fee_minor,currency,payment_status,payment_transaction_id,
    payment_confirmed_at,platform_fee_minor,courier_payout_minor,payout_status
  )
  values(
    v_order.id,v_order.buyer_id,v_order.seller_id,'pending',null,v_order.delivery_address,
    v_fee,v_currency,'paid',v_tx_id,now(),0,v_fee,'pending'
  )
  on conflict(order_id) do update set
    payment_status='paid', payment_transaction_id=excluded.payment_transaction_id,
    payment_confirmed_at=coalesce(public.marketplace_deliveries.payment_confirmed_at,excluded.payment_confirmed_at),
    delivery_fee_minor=excluded.delivery_fee_minor, currency=excluded.currency,
    courier_payout_minor=excluded.courier_payout_minor, updated_at=now()
  returning id into v_id;

  insert into public.marketplace_delivery_platform_ledger(delivery_id,entry_type,amount_minor,currency,metadata)
  values(v_id,'delivery_fee_credit',v_fee,v_currency,
    jsonb_build_object('order_id',v_order.id,'payment_transaction_id',v_tx_id,'source','wallet_checkout'))
  on conflict(delivery_id,entry_type) do nothing;

  update public.orders set delivery_status='pending',updated_at=now() where id=v_order.id;
  return v_id;
end
$function$;

create or replace function public.claim_marketplace_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.marketplace_delivery_agents a where a.user_id=auth.uid() and a.active and a.blocked_at is null) then
    raise exception 'DELIVERY_AGENT_BLOCKED_OR_NOT_ACTIVE';
  end if;
  if not exists(select 1 from public.marketplace_deliveries d where d.id=p_delivery_id and d.payment_status='paid') then
    raise exception 'DELIVERY_PAYMENT_NOT_VERIFIED';
  end if;

  update public.marketplace_deliveries
  set courier_id=auth.uid(),status='assigned',updated_at=now()
  where id=p_delivery_id and status='pending' and courier_id is null;
  if not found then return false; end if;

  insert into public.marketplace_delivery_events(delivery_id,status,note)
  values(p_delivery_id,'assigned','Courier accepted a platform-paid delivery');
  return true;
end
$function$;

create or replace function public.update_marketplace_delivery_location(
  p_delivery_id uuid,p_lat double precision,p_lng double precision,
  p_status text default 'in_transit',p_eta_minutes integer default null
)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
  if p_status not in ('assigned','picked_up','in_transit') then raise exception 'INVALID_STATUS'; end if;
  if not exists(select 1 from public.marketplace_delivery_agents a where a.user_id=auth.uid() and a.active and a.blocked_at is null) then
    raise exception 'DELIVERY_AGENT_BLOCKED_OR_NOT_ACTIVE';
  end if;

  update public.marketplace_deliveries
  set status=p_status,courier_lat=p_lat,courier_lng=p_lng,courier_updated_at=now(),
      eta_minutes=greatest(0,coalesce(p_eta_minutes,eta_minutes)),updated_at=now()
  where id=p_delivery_id and courier_id=auth.uid() and payment_status='paid'
    and status not in ('delivered','cancelled');
  if not found then return false; end if;

  insert into public.marketplace_delivery_events(delivery_id,status,latitude,longitude,eta_minutes)
  values(p_delivery_id,p_status,p_lat,p_lng,p_eta_minutes);
  return true;
end
$function$;

create or replace function public.confirm_marketplace_delivery(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_d public.marketplace_deliveries%rowtype;
  v_agent public.marketplace_delivery_agents%rowtype;
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_payout numeric;
  v_currency text;
  v_txid uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_d from public.marketplace_deliveries where id=p_delivery_id and buyer_id=auth.uid() for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  if v_d.payment_status <> 'paid' then raise exception 'DELIVERY_PAYMENT_NOT_VERIFIED'; end if;
  if v_d.courier_id is null then raise exception 'COURIER_NOT_ASSIGNED'; end if;
  if v_d.status in ('delivered','cancelled') then return jsonb_build_object('ok',true,'already_complete',true,'payout_status',v_d.payout_status); end if;

  select * into v_agent from public.marketplace_delivery_agents where user_id=v_d.courier_id for update;
  if not found or not v_agent.active then raise exception 'COURIER_NOT_ACTIVE'; end if;

  update public.marketplace_deliveries set status='delivered',updated_at=now() where id=v_d.id;
  insert into public.marketplace_delivery_events(delivery_id,status,note)
  values(v_d.id,'delivered','Buyer confirmed delivery; platform payment verified');
  update public.orders set delivery_status='delivered',delivered_at=now(),updated_at=now() where id=v_d.order_id;

  if v_d.courier_payout_minor=0 then
    update public.marketplace_deliveries set payout_status='paid',updated_at=now() where id=v_d.id;
    return jsonb_build_object('ok',true,'payout_status','paid','payout_minor',0,'congratulations',true);
  end if;

  if v_agent.blocked_at is not null then
    update public.marketplace_deliveries set payout_status='blocked',updated_at=now() where id=v_d.id;
    return jsonb_build_object('ok',true,'payout_status','blocked','congratulations',false);
  end if;

  select * into v_wallet from public.wallets where user_id=v_d.courier_id::text for update;
  if not found then raise exception 'COURIER_WALLET_NOT_FOUND'; end if;

  v_currency:=upper(coalesce(v_wallet.currency,'USD'));
  if v_currency=v_d.currency then v_payout:=round(v_d.courier_payout_minor/100.0,2);
  elsif v_currency='USD' and v_d.currency='KES' then v_payout:=round((v_d.courier_payout_minor/100.0)/130,2);
  elsif v_currency='KES' and v_d.currency='USD' then v_payout:=round((v_d.courier_payout_minor/100.0)*130,2);
  else raise exception 'UNSUPPORTED_COURIER_WALLET_CURRENCY'; end if;

  v_before:=coalesce(v_wallet.balance,0);
  update public.wallets set balance=balance+v_payout,updated_at=now() where id=v_wallet.id;

  insert into public.wallet_transactions(
    wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,
    balance_before,balance_after,provider,provider_order_id,provider_reference,
    provider_status,description,metadata,payment_method,reference,
    transfer_id,counterparty_user_id,idempotency_key,completed_at,created_at,updated_at
  )
  values(
    v_wallet.id,v_d.courier_id::text,'delivery_payout','delivery_payout',v_payout,
    round(v_payout*100)::bigint,v_currency,'in','completed',v_before,v_before+v_payout,
    'testagram_platform',v_d.order_id::text,'DELIVERY-'||v_d.id::text,'completed',
    'Marketplace delivery payout',
    jsonb_build_object('delivery_id',v_d.id,'order_id',v_d.order_id,'delivery_fee_minor',v_d.delivery_fee_minor,'payout_minor',v_d.courier_payout_minor),
    'wallet','delivery-payout:'||v_d.id::text,v_d.order_id,v_d.buyer_id::text,
    'delivery-payout:'||v_d.id::text,now(),now(),now()
  )
  returning id into v_txid;

  insert into public.marketplace_delivery_platform_ledger(
    delivery_id,entry_type,amount_minor,currency,courier_id,wallet_transaction_id,metadata
  )
  values(v_d.id,'courier_payout_debit',v_d.courier_payout_minor,v_d.currency,v_d.courier_id,v_txid,
    jsonb_build_object('payout_currency',v_currency,'payout_amount',v_payout))
  on conflict(delivery_id,entry_type) do nothing;

  update public.marketplace_deliveries
  set payout_status='paid',payout_transaction_id=v_txid,updated_at=now()
  where id=v_d.id;

  return jsonb_build_object('ok',true,'payout_status','paid','payout_minor',v_d.courier_payout_minor,
    'payout_amount',v_payout,'payout_currency',v_currency,'congratulations',true);
end
$function$;

create or replace function public.report_marketplace_delivery_violation(
  p_delivery_id uuid,p_violation_type text,p_severity integer default 100,p_evidence text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_d public.marketplace_deliveries%rowtype;
  v_score integer;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_d from public.marketplace_deliveries
  where id=p_delivery_id and ((select auth.uid())=buyer_id or (select auth.uid())=seller_id)
  for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  if v_d.courier_id is null then raise exception 'COURIER_NOT_ASSIGNED'; end if;

  if p_violation_type not in ('off_platform_payment','cash_collection','bypass_platform','fake_completion','other') then
    raise exception 'INVALID_VIOLATION_TYPE';
  end if;

  insert into public.marketplace_delivery_violations(
    delivery_id,courier_id,reporter_id,violation_type,severity,evidence
  )
  values(v_d.id,v_d.courier_id,auth.uid(),p_violation_type,greatest(1,least(100,coalesce(p_severity,100))),left(p_evidence,2000));

  v_score:=case
    when p_violation_type in ('off_platform_payment','cash_collection','bypass_platform') then 100
    when p_violation_type='fake_completion' then 80
    else greatest(20,least(70,coalesce(p_severity,50)))
  end;

  select count(*) into v_count from public.marketplace_delivery_violations where courier_id=v_d.courier_id;

  update public.marketplace_delivery_agents
  set risk_score=least(100,greatest(risk_score,v_score)),violation_count=v_count,last_violation_at=now(),
      blocked_at=case when v_score>=100 or v_count>=3 then coalesce(blocked_at,now()) else blocked_at end,
      blocked_reason=case when v_score>=100 or v_count>=3 then 'Platform payment policy violation' else blocked_reason end,
      active=case when v_score>=100 or v_count>=3 then false else active end,updated_at=now()
  where user_id=v_d.courier_id;

  if v_score>=100 or v_count>=3 then
    update public.marketplace_deliveries set payout_status='blocked',updated_at=now()
    where courier_id=v_d.courier_id and payout_status='pending';
  end if;

  return jsonb_build_object('ok',true,'blocked',v_score>=100 or v_count>=3,'risk_score',v_score,'violation_count',v_count);
end
$function$;

revoke execute on function public.confirm_marketplace_delivery(uuid) from public,anon;
revoke execute on function public.report_marketplace_delivery_violation(uuid,text,integer,text) from public,anon;
grant execute on function public.confirm_marketplace_delivery(uuid) to authenticated;
grant execute on function public.report_marketplace_delivery_violation(uuid,text,integer,text) to authenticated;

alter table public.marketplace_deliveries replica identity full;
alter table public.marketplace_delivery_platform_ledger replica identity full;
