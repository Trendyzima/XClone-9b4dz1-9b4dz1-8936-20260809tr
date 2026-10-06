-- Marketplace 10/10 lifecycle hardening.
-- Production applied on 2026-10-06. This migration is the tracked source of truth
-- for reservation, trust, escrow settlement, risk, disputes, refunds and audit.

begin;

alter table public.products add column if not exists reserved_inventory_count integer not null default 0;
alter table public.orders
  add column if not exists seller_settlement_status text not null default 'held',
  add column if not exists seller_settlement_amount_minor bigint,
  add column if not exists seller_settlement_currency text,
  add column if not exists risk_score integer not null default 0,
  add column if not exists risk_status text not null default 'clear',
  add column if not exists refund_status text not null default 'none';

create table if not exists public.marketplace_seller_trust(
 seller_id uuid primary key references auth.users(id) on delete cascade,
 status text not null default 'probation' check(status in('probation','verified','suspended','blocked')),
 trust_score integer not null default 50 check(trust_score between 0 and 100),
 verified boolean not null default false, completed_orders integer not null default 0,
 dispute_count integer not null default 0, fraud_flags integer not null default 0,
 last_reviewed_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.marketplace_inventory_reservations(
 id uuid primary key default gen_random_uuid(), reservation_key text not null unique,
 buyer_id uuid not null references auth.users(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 quantity integer not null check(quantity between 1 and 100),
 status text not null default 'reserved' check(status in('reserved','consumed','released','expired')),
 expires_at timestamptz not null, consumed_order_id uuid references public.orders(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists marketplace_inventory_reservations_product_idx
 on public.marketplace_inventory_reservations(product_id,status,expires_at);

create table if not exists public.marketplace_disputes(
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id) on delete restrict,
 delivery_id uuid references public.marketplace_deliveries(id) on delete restrict,
 opened_by uuid not null references auth.users(id), reason text not null,
 status text not null default 'open', description text, evidence jsonb not null default '[]'::jsonb,
 resolution_note text, resolved_by uuid references auth.users(id), resolved_at timestamptz,
 refund_amount_minor bigint not null default 0, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(reason in('not_received','damaged','not_as_described','wrong_item','fraud','delivery_issue','other')),
 check(status in('open','investigating','resolved_buyer','resolved_seller','denied','cancelled'))
);
create table if not exists public.marketplace_refunds(
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 dispute_id uuid references public.marketplace_disputes(id), buyer_id uuid not null references auth.users(id),
 amount_minor bigint not null check(amount_minor>0), currency text not null,
 status text not null default 'pending' check(status in('pending','processed','failed')),
 idempotency_key text not null unique, ledger_transaction_id uuid, reason text,
 created_at timestamptz not null default now(), processed_at timestamptz
);
create table if not exists public.marketplace_risk_events(
 id bigint generated always as identity primary key, order_id uuid references public.orders(id) on delete cascade,
 buyer_id uuid references auth.users(id) on delete set null, seller_id uuid references auth.users(id) on delete set null,
 delivery_id uuid references public.marketplace_deliveries(id) on delete set null,
 event_type text not null, severity integer not null check(severity between 1 and 100),
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.marketplace_audit_log(
 id bigint generated always as identity primary key, order_id uuid, delivery_id uuid, actor_id uuid,
 action text not null, outcome text not null, metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), previous_hash text, event_hash text not null
);

alter table public.marketplace_seller_trust enable row level security;
alter table public.marketplace_inventory_reservations enable row level security;
alter table public.marketplace_disputes enable row level security;
alter table public.marketplace_refunds enable row level security;
alter table public.marketplace_risk_events enable row level security;
alter table public.marketplace_audit_log enable row level security;
revoke all on public.marketplace_seller_trust,public.marketplace_inventory_reservations,public.marketplace_disputes,
 public.marketplace_refunds,public.marketplace_risk_events,public.marketplace_audit_log from anon,authenticated;
grant select on public.marketplace_seller_trust,public.marketplace_inventory_reservations,public.marketplace_disputes,
 public.marketplace_refunds,public.marketplace_risk_events,public.marketplace_audit_log to authenticated;

create or replace function public.marketplace_audit(p_order_id uuid,p_delivery_id uuid,p_actor_id uuid,p_action text,p_outcome text,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare prev text; h text;
begin
 perform pg_advisory_xact_lock(hashtextextended('marketplace-audit-global',0));
 select event_hash into prev from public.marketplace_audit_log order by id desc limit 1;
 h:=encode(digest(coalesce(prev,'')||'|'||coalesce(p_order_id::text,'')||'|'||coalesce(p_delivery_id::text,'')||'|'||
 coalesce(p_actor_id::text,'')||'|'||p_action||'|'||p_outcome||'|'||coalesce(p_metadata,'{}'::jsonb)::text||'|'||
 clock_timestamp()::text,'sha256'),'hex');
 insert into public.marketplace_audit_log(order_id,delivery_id,actor_id,action,outcome,metadata,previous_hash,event_hash)
 values(p_order_id,p_delivery_id,p_actor_id,p_action,p_outcome,coalesce(p_metadata,'{}'::jsonb),prev,h);
end $$;
revoke all on function public.marketplace_audit(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;

create or replace function public.refresh_marketplace_seller_trust(p_seller_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v boolean; completed integer; disputes integer; fraud integer; score integer; st text;
begin
 select coalesce(verified,false) into v from public.profiles where id=p_seller_id;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 select count(*) filter(where status='delivered') into completed from public.orders where seller_id=p_seller_id;
 select count(*) into disputes from public.marketplace_disputes where exists(select 1 from public.orders o where o.id=order_id and o.seller_id=p_seller_id);
 select count(*) into fraud from public.marketplace_risk_events where seller_id=p_seller_id and severity>=80;
 score:=least(100,greatest(0,50+(case when v then 25 else 0 end)+least(15,completed)-least(30,disputes*10)-least(25,fraud*10)));
 st:=case when fraud>=3 or disputes>=5 then 'suspended' when v and score>=75 then 'verified' else 'probation' end;
 insert into public.marketplace_seller_trust(seller_id,status,trust_score,verified,completed_orders,dispute_count,fraud_flags,last_reviewed_at,updated_at)
 values(p_seller_id,st,score,v,completed,disputes,fraud,now(),now())
 on conflict(seller_id) do update set status=excluded.status,trust_score=excluded.trust_score,verified=excluded.verified,
 completed_orders=excluded.completed_orders,dispute_count=excluded.dispute_count,fraud_flags=excluded.fraud_flags,last_reviewed_at=now(),updated_at=now();
 return jsonb_build_object('status',st,'trust_score',score,'verified',v);
end $$;

create or replace function public.expire_marketplace_inventory_reservations()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 with expired as(
  update public.marketplace_inventory_reservations set status='expired',updated_at=now()
  where status='reserved' and expires_at<=now() returning product_id,quantity
 ), totals as(select product_id,sum(quantity)::integer quantity from expired group by product_id)
 update public.products p set reserved_inventory_count=greatest(0,p.reserved_inventory_count-t.quantity),updated_at=now()
 from totals t where p.id=t.product_id;
 get diagnostics n=row_count; return n;
end $$;

create or replace function public.reserve_marketplace_inventory(p_product_id uuid,p_quantity integer,p_reservation_key text,p_ttl_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.products%rowtype; r public.marketplace_inventory_reservations%rowtype;
 trust public.marketplace_seller_trust%rowtype; available integer;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_quantity not between 1 and 100 then raise exception 'INVALID_QUANTITY'; end if;
 if p_reservation_key is null or length(trim(p_reservation_key))<16 then raise exception 'RESERVATION_KEY_REQUIRED'; end if;
 perform public.expire_marketplace_inventory_reservations();
 select * into p from public.products where id=p_product_id for update;
 if not found or p.status<>'active' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
 if p.seller_id=u then raise exception 'SELF_PURCHASE_NOT_ALLOWED'; end if;
 select * into trust from public.marketplace_seller_trust where seller_id=p.seller_id;
 if not found then perform public.refresh_marketplace_seller_trust(p.seller_id); select * into trust from public.marketplace_seller_trust where seller_id=p.seller_id; end if;
 if trust.status in('suspended','blocked') then raise exception 'SELLER_NOT_TRUSTED'; end if;
 select * into r from public.marketplace_inventory_reservations where reservation_key=trim(p_reservation_key) for update;
 if found then
  if r.buyer_id<>u or r.product_id<>p_product_id or r.quantity<>p_quantity then raise exception 'RESERVATION_KEY_REUSED'; end if;
  if r.status='reserved' and r.expires_at>now() then return jsonb_build_object('ok',true,'reservation_id',r.id,'expires_at',r.expires_at); end if;
  if r.status='consumed' then raise exception 'RESERVATION_ALREADY_CONSUMED'; end if;
  update public.marketplace_inventory_reservations set status='reserved',expires_at=now()+make_interval(secs=>greatest(60,least(1800,p_ttl_seconds))),updated_at=now() where id=r.id returning * into r;
  update public.products set reserved_inventory_count=reserved_inventory_count+r.quantity,updated_at=now() where id=p.id;
 else
  available:=p.inventory_count-p.reserved_inventory_count;
  if available<p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
  insert into public.marketplace_inventory_reservations(reservation_key,buyer_id,product_id,quantity,expires_at)
  values(trim(p_reservation_key),u,p_product_id,p_quantity,now()+make_interval(secs=>greatest(60,least(1800,p_ttl_seconds)))) returning * into r;
  update public.products set reserved_inventory_count=reserved_inventory_count+p_quantity,updated_at=now() where id=p.id;
 end if;
 perform public.marketplace_audit(null,null,u,'inventory.reserve','success',jsonb_build_object('product_id',p_product_id,'quantity',p_quantity,'reservation_id',r.id));
 return jsonb_build_object('ok',true,'reservation_id',r.id,'expires_at',r.expires_at);
end $$;
grant execute on function public.reserve_marketplace_inventory(uuid,integer,text,integer) to authenticated;

-- Checkout is deliberately idempotent and consumes the server-side reservation.
-- The six-argument legacy signature remains as a compatibility wrapper.
drop function if exists public.place_marketplace_order(uuid,integer,text,text,text,text);
create or replace function public.place_marketplace_order(p_product_id uuid,p_quantity integer,p_idempotency_key text default null,
 p_delivery_mode text default 'seller_delivery',p_delivery_address text default null,p_delivery_note text default null,p_reservation_key text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.products%rowtype; w public.wallets%rowtype; r public.marketplace_inventory_reservations%rowtype;
 oid uuid; old_oid uuid; fee bigint:=0; subtotal bigint; total bigint; debit numeric; before_balance numeric; wc text; pc text;
 payment_minor bigint; ua uuid; pa uuid; ledger_id uuid; trust public.marketplace_seller_trust%rowtype; risk integer:=0; risk_status text:='clear'; recent integer;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_idempotency_key is null or length(trim(p_idempotency_key))<16 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 if p_quantity not between 1 and 100 then raise exception 'INVALID_QUANTITY'; end if;
 perform pg_advisory_xact_lock(hashtextextended('marketplace-checkout:'||u::text||':'||p_idempotency_key,0));
 select id into old_oid from public.orders where buyer_id=u and marketplace_idempotency_key=p_idempotency_key limit 1;
 if old_oid is not null then return old_oid; end if;
 perform public.expire_marketplace_inventory_reservations();
 select * into p from public.products where id=p_product_id for update;
 if not found or p.status<>'active' or p.seller_id=u then raise exception 'PRODUCT_UNAVAILABLE'; end if;
 select * into trust from public.marketplace_seller_trust where seller_id=p.seller_id;
 if not found then perform public.refresh_marketplace_seller_trust(p.seller_id); select * into trust from public.marketplace_seller_trust where seller_id=p.seller_id; end if;
 if trust.status in('suspended','blocked') then raise exception 'SELLER_NOT_TRUSTED'; end if;
 if p_reservation_key is null then raise exception 'RESERVATION_REQUIRED'; end if;
 select * into r from public.marketplace_inventory_reservations where reservation_key=trim(p_reservation_key) for update;
 if not found or r.buyer_id<>u or r.product_id<>p.id or r.quantity<>p_quantity or r.status<>'reserved' or r.expires_at<=now() then raise exception 'RESERVATION_INVALID_OR_EXPIRED'; end if;
 if p_delivery_mode not in('pickup','seller_delivery','local_delivery') then raise exception 'INVALID_DELIVERY_MODE'; end if;
 if p_delivery_mode<>'pickup' and nullif(trim(coalesce(p_delivery_address,'')),'') is null then raise exception 'DELIVERY_ADDRESS_REQUIRED'; end if;
 if p_delivery_mode='local_delivery' and not p.local_delivery then raise exception 'LOCAL_DELIVERY_UNAVAILABLE'; end if;
 fee:=case when p_delivery_mode='local_delivery' then coalesce(p.delivery_fee_minor,0) else 0 end;
 subtotal:=p.price_minor*p_quantity; total:=subtotal+fee; pc:=upper(coalesce(p.currency,'KES'));
 select * into w from public.wallets where user_id=u::text for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 wc:=upper(coalesce(w.currency,'KES'));
 debit:=case when wc=pc then round(total/100.0,2) when wc='USD' and pc='KES' then round((total/100.0)/130,2)
 when wc='KES' and pc='USD' then round((total/100.0)*130,2) when wc='EUR' and pc='KES' then round((total/100.0)/150,2)
 when wc='KES' and pc='EUR' then round((total/100.0)*150,2) else null end;
 if debit is null or coalesce(w.balance,0)<debit then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
 select count(*) into recent from public.orders where buyer_id=u and created_at>=now()-interval '10 minutes';
 risk:=risk+(case when recent>=5 then 40 when recent>=3 then 20 else 0 end)+(case when p_quantity>=20 then 25 when p_quantity>=10 then 10 else 0 end);
 if risk>=60 then risk_status:='review'; end if; if risk>=90 then risk_status:='blocked'; end if;
 if risk_status='blocked' then raise exception 'MARKETPLACE_RISK_BLOCK'; end if;
 payment_minor:=round(debit*100)::bigint; perform private.ensure_user_financial_accounts(u,wc);
 select id into ua from public.wallet_accounts where account_type='USER' and user_id=u and currency=wc limit 1;
 insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM',wc,'ACTIVE') on conflict do nothing;
 select id into pa from public.wallet_accounts where account_type='PLATFORM' and currency=wc for update;
 oid:=gen_random_uuid();
 ledger_id:=private.post_wallet_ledger('MARKETPLACE_ESCROW_HOLD','marketplace_order',oid,'marketplace-hold:'||u::text||':'||p_idempotency_key,
 'Marketplace escrow hold',jsonb_build_array(jsonb_build_object('account_id',ua,'direction','DEBIT','amount_minor',payment_minor),
 jsonb_build_object('account_id',pa,'direction','CREDIT','amount_minor',payment_minor)),jsonb_build_object('product_id',p.id,'risk_score',risk));
 before_balance:=coalesce(w.balance,0);
 update public.wallets set balance=balance-debit,updated_at=now() where id=w.id;
 update public.products set inventory_count=inventory_count-p_quantity,reserved_inventory_count=greatest(0,reserved_inventory_count-p_quantity),
 stock=greatest(0,coalesce(stock,inventory_count)-p_quantity),sales_count=coalesce(sales_count,0)+p_quantity,updated_at=now() where id=p.id;
 update public.marketplace_inventory_reservations set status='consumed',consumed_order_id=oid,updated_at=now() where id=r.id;
 insert into public.orders(id,buyer_id,seller_id,product_id,quantity,total_minor,currency,status,unit_price_minor,total_amount,payment_method,
 payment_reference,paid_at,created_at,updated_at,delivery_mode,delivery_fee_minor,delivery_address,delivery_note,delivery_status,escrow_status,
 payment_currency,payment_amount_minor,payment_ledger_transaction_id,marketplace_idempotency_key,seller_settlement_status,seller_settlement_amount_minor,
 seller_settlement_currency,risk_score,risk_status)
 values(oid,u,p.seller_id,p.id,p_quantity,total,pc,'confirmed',p.price_minor,round(total/100.0,2),'wallet','MALL-'||replace(gen_random_uuid()::text,'-',''),
 now(),now(),now(),p_delivery_mode,fee,nullif(trim(p_delivery_address),''),nullif(trim(p_delivery_note),''),'pending','held',wc,payment_minor,ledger_id,
 p_idempotency_key,case when risk_status='review' then 'blocked' else 'held' end,subtotal,pc,risk,risk_status);
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,
 provider_order_id,provider_reference,provider_status,description,metadata,payment_method,reference,transfer_id,counterparty_user_id,idempotency_key,completed_at,created_at,updated_at)
 values(w.id,u::text,'purchase','purchase',debit,payment_minor,wc,'out','completed',before_balance,before_balance-debit,'testagram_escrow',oid::text,
 'MALL-'||oid::text,'completed','Marketplace escrow hold',jsonb_build_object('order_id',oid,'ledger_transaction_id',ledger_id,'risk_score',risk),
 'wallet','marketplace:'||oid::text,oid,p.seller_id::text,'marketplace-hold:'||u::text||':'||p_idempotency_key,now(),now(),now());
 insert into public.marketplace_order_events(order_id,actor_id,event_type,to_status,metadata) values(oid,u,'created','confirmed',jsonb_build_object('risk_score',risk));
 if risk_status='review' then insert into public.marketplace_risk_events(order_id,buyer_id,seller_id,event_type,severity,metadata)
 values(oid,u,p.seller_id,'checkout_risk_hold',risk,jsonb_build_object('recent_orders',recent,'quantity',p_quantity)); end if;
 perform public.marketplace_audit(oid,null,u,'checkout','success',jsonb_build_object('risk_score',risk,'seller_trust_score',trust.trust_score));
 return oid;
end $$;
create or replace function public.place_marketplace_order(p_product_id uuid,p_quantity integer,p_idempotency_key text,p_delivery_mode text,p_delivery_address text,p_delivery_note text)
returns uuid language sql security definer set search_path='' as $$ select public.place_marketplace_order($1,$2,$3,$4,$5,$6,null) $$;
grant execute on function public.place_marketplace_order(uuid,integer,text,text,text,text,text) to authenticated;
grant execute on function public.place_marketplace_order(uuid,integer,text,text,text,text) to authenticated;

-- Buyer confirmation is a settlement gate. Seller settlement is posted first; courier
-- settlement posts second into DRIVER_PAYABLE. No client can write either ledger.
create or replace function public.confirm_marketplace_delivery(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.marketplace_deliveries%rowtype; o public.orders%rowtype; a public.marketplace_delivery_agents%rowtype;
 seller_account uuid; platform_account uuid; driver_account uuid; seller_ledger uuid; courier_ledger uuid;
 seller_minor bigint; delivery_minor bigint; fee_minor bigint; net_minor bigint; currency_code text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into d from public.marketplace_deliveries where id=p_delivery_id and buyer_id=auth.uid() for update;
 if not found or d.payment_status<>'paid' or d.courier_id is null then raise exception 'DELIVERY_NOT_READY'; end if;
 if d.status<>'delivered' or d.delivery_verified_at is null then raise exception 'DELIVERY_NOT_VERIFIED'; end if;
 select * into o from public.orders where id=d.order_id for update;
 if not found or o.escrow_status<>'held' then return jsonb_build_object('ok',true,'already_complete',true); end if;
 if o.risk_status in('review','blocked') or o.seller_settlement_status='blocked' then
  update public.marketplace_deliveries set buyer_confirmed_at=now(),payout_status='blocked',updated_at=now() where id=d.id;
  perform public.marketplace_audit(o.id,d.id,auth.uid(),'delivery.confirm','risk_hold',jsonb_build_object('risk_status',o.risk_status));
  return jsonb_build_object('ok',true,'settled',false,'reason','ORDER_RISK_REVIEW');
 end if;
 select * into a from public.marketplace_delivery_agents where user_id=d.courier_id for update;
 if not found or a.blocked_at is not null then raise exception 'COURIER_RISK_BLOCK'; end if;
 currency_code:=upper(coalesce(o.payment_currency,o.currency,'KES'));
 seller_minor:=o.unit_price_minor*o.quantity; delivery_minor:=coalesce(o.delivery_fee_minor,0);
 fee_minor:=round(delivery_minor*0.10); net_minor:=delivery_minor-fee_minor;
 perform private.ensure_user_financial_accounts(o.seller_id,currency_code);
 select id into seller_account from public.wallet_accounts where account_type='USER' and user_id=o.seller_id and currency=currency_code for update;
 insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM',currency_code,'ACTIVE') on conflict do nothing;
 select id into platform_account from public.wallet_accounts where account_type='PLATFORM' and currency=currency_code for update;
 seller_ledger:=private.post_wallet_ledger('MARKETPLACE_SELLER_SETTLEMENT','marketplace_order',o.id,'marketplace-seller-settlement:'||o.id::text,
 'Marketplace seller settlement',jsonb_build_array(jsonb_build_object('account_id',platform_account,'direction','DEBIT','amount_minor',seller_minor),
 jsonb_build_object('account_id',seller_account,'direction','CREDIT','amount_minor',seller_minor)),jsonb_build_object('order_id',o.id,'currency',currency_code));
 update public.orders set seller_settlement_status='released',seller_settlement_amount_minor=seller_minor,seller_settlement_currency=currency_code,
 seller_payout_ledger_transaction_id=seller_ledger,escrow_status='released',status='delivered',delivery_status='delivered',delivered_at=coalesce(delivered_at,now()),updated_at=now()
 where id=o.id;
 if delivery_minor>0 then
  perform private.ensure_user_financial_accounts(d.courier_id,currency_code);
  select id into driver_account from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=d.courier_id and currency=currency_code for update;
  courier_ledger:=private.post_wallet_ledger('MARKETPLACE_COURIER_SETTLEMENT','marketplace_delivery',d.id,'marketplace-courier-settlement:'||d.id::text,
  'Marketplace courier settlement',jsonb_build_array(jsonb_build_object('account_id',platform_account,'direction','DEBIT','amount_minor',delivery_minor),
  jsonb_build_object('account_id',driver_account,'direction','CREDIT','amount_minor',net_minor),
  jsonb_build_object('account_id',platform_account,'direction','CREDIT','amount_minor',fee_minor)),
  jsonb_build_object('delivery_id',d.id,'gross_minor',delivery_minor,'platform_fee_minor',fee_minor,'net_minor',net_minor));
  insert into public.marketplace_delivery_earnings(delivery_id,courier_id,gross_amount,platform_fee,net_amount,currency,status,metadata)
  values(d.id,d.courier_id,delivery_minor/100.0,fee_minor/100.0,net_minor/100.0,currency_code,'available',jsonb_build_object('ledger_transaction_id',courier_ledger,'platform_fee_rate',0.10))
  on conflict(delivery_id) do nothing;
  update public.marketplace_deliveries set buyer_confirmed_at=now(),payout_status='pending',payout_transaction_id=courier_ledger,updated_at=now() where id=d.id;
 else update public.marketplace_deliveries set buyer_confirmed_at=now(),payout_status='paid',updated_at=now() where id=d.id; end if;
 insert into public.marketplace_order_events(order_id,actor_id,event_type,metadata) values(o.id,auth.uid(),'seller_settled',jsonb_build_object('ledger_transaction_id',seller_ledger));
 if courier_ledger is not null then insert into public.marketplace_order_events(order_id,actor_id,event_type,metadata) values(o.id,auth.uid(),'courier_settled',jsonb_build_object('ledger_transaction_id',courier_ledger)); end if;
 perform public.marketplace_audit(o.id,d.id,auth.uid(),'delivery.confirm','success',jsonb_build_object('seller_ledger',seller_ledger,'courier_ledger',courier_ledger));
 return jsonb_build_object('ok',true,'seller_settled',true,'courier_payout_status',case when delivery_minor>0 then 'pending' else 'paid' end);
end $$;
grant execute on function public.confirm_marketplace_delivery(uuid) to authenticated;

-- Cancellation/refund restores inventory and returns the held buyer funds atomically.
create or replace function public.advance_marketplace_order(p_order_id uuid,p_next_status text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; u uuid:=auth.uid(); w public.wallets%rowtype; ua uuid; pa uuid; p public.products%rowtype; ledger_id uuid; amount numeric; before_balance numeric; c text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_next_status='shipped' then
  if o.seller_id<>u or o.status<>'confirmed' or o.escrow_status<>'held' or o.risk_status<>'clear' then raise exception 'FORBIDDEN_OR_INVALID_TRANSITION'; end if;
  update public.orders set status='shipped',shipped_at=now(),updated_at=now() where id=o.id;
  insert into public.marketplace_order_events(order_id,actor_id,event_type,from_status,to_status) values(o.id,u,'shipped',o.status,'shipped');
  return jsonb_build_object('ok',true,'status','shipped');
 elsif p_next_status='cancelled' then
  if o.buyer_id<>u and o.seller_id<>u then raise exception 'FORBIDDEN'; end if;
  if o.status<>'confirmed' or o.escrow_status<>'held' then raise exception 'ORDER_ALREADY_DISPATCHED'; end if;
  c:=upper(coalesce(o.payment_currency,o.currency,'KES')); amount:=round(o.payment_amount_minor/100.0,2);
  select * into w from public.wallets where user_id=o.buyer_id::text for update;
  perform private.ensure_user_financial_accounts(o.buyer_id,c);
  select id into ua from public.wallet_accounts where account_type='USER' and user_id=o.buyer_id and currency=c limit 1;
  select id into pa from public.wallet_accounts where account_type='PLATFORM' and currency=c limit 1;
  ledger_id:=private.post_wallet_ledger('MARKETPLACE_ESCROW_REFUND','marketplace_order',o.id,'marketplace-refund:'||o.id::text,
  'Marketplace escrow refund',jsonb_build_array(jsonb_build_object('account_id',pa,'direction','DEBIT','amount_minor',o.payment_amount_minor),
  jsonb_build_object('account_id',ua,'direction','CREDIT','amount_minor',o.payment_amount_minor)),jsonb_build_object('reason',p_reason));
  before_balance:=coalesce(w.balance,0); if upper(coalesce(w.currency,'KES'))=c then update public.wallets set balance=balance+amount,updated_at=now() where id=w.id; end if;
  update public.orders set status='cancelled',cancelled_at=now(),cancellation_reason=left(nullif(trim(p_reason),''),500),escrow_status='refunded',seller_settlement_status='refunded',refund_status='refunded',updated_at=now() where id=o.id;
  select * into p from public.products where id=o.product_id for update;
  if found then update public.products set inventory_count=inventory_count+o.quantity,stock=coalesce(stock,inventory_count)+o.quantity,updated_at=now() where id=p.id; end if;
  insert into public.marketplace_refunds(order_id,buyer_id,amount_minor,currency,status,idempotency_key,ledger_transaction_id,reason,processed_at)
  values(o.id,o.buyer_id,o.payment_amount_minor,c,'processed','cancel-refund:'||o.id::text,ledger_id,p_reason,now()) on conflict(idempotency_key) do nothing;
  perform public.marketplace_audit(o.id,null,u,'order.cancel','success',jsonb_build_object('refund_ledger',ledger_id));
  return jsonb_build_object('ok',true,'status','cancelled','refunded',true);
 else raise exception 'INVALID_ORDER_TRANSITION'; end if;
end $$;
grant execute on function public.advance_marketplace_order(uuid,text,text) to authenticated;

-- Disputes freeze settlement; only governance permission can resolve and refund.
create or replace function public.open_marketplace_dispute(p_order_id uuid,p_reason text,p_description text default null,p_evidence jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.orders%rowtype; did uuid; d uuid;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into o from public.orders where id=p_order_id and (buyer_id=u or seller_id=u) for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 select id into d from public.marketplace_deliveries where order_id=o.id limit 1;
 insert into public.marketplace_disputes(order_id,delivery_id,opened_by,reason,description,evidence) values(o.id,d,u,p_reason,left(p_description,4000),coalesce(p_evidence,'[]'::jsonb))
 on conflict(order_id) do update set status='open',opened_by=excluded.opened_by,reason=excluded.reason,description=excluded.description,evidence=excluded.evidence,updated_at=now()
 returning id into did;
 update public.orders set escrow_status=case when escrow_status in('held','released') then 'disputed' else escrow_status end,refund_status='requested',
 seller_settlement_status=case when seller_settlement_status='released' then 'released' else 'blocked' end,updated_at=now() where id=o.id;
 if d is not null then update public.marketplace_deliveries set payout_status=case when payout_status='paid' then payout_status else 'blocked' end,updated_at=now() where id=d; end if;
 perform public.marketplace_audit(o.id,d,u,'dispute.open','success',jsonb_build_object('dispute_id',did,'reason',p_reason));
 return did;
end $$;
grant execute on function public.open_marketplace_dispute(uuid,text,text,jsonb) to authenticated;

select cron.schedule('marketplace-inventory-reservation-expiry','* * * * *','select public.expire_marketplace_inventory_reservations()');

commit;
