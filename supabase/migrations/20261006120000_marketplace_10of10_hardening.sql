begin;

alter table public.orders
  add column if not exists escrow_status text not null default 'none',
  add column if not exists payment_currency text,
  add column if not exists payment_amount_minor bigint,
  add column if not exists payment_ledger_transaction_id uuid,
  add column if not exists seller_payout_ledger_transaction_id uuid,
  add column if not exists marketplace_idempotency_key text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;
alter table public.orders drop constraint if exists orders_escrow_status_check;
alter table public.orders add constraint orders_escrow_status_check
  check (escrow_status in ('none','held','released','refunded','disputed','cancelled'));
create unique index if not exists orders_marketplace_idempotency_uq
  on public.orders(buyer_id,marketplace_idempotency_key)
  where marketplace_idempotency_key is not null;

create table if not exists public.marketplace_order_events(
 id bigint generated always as identity primary key,
 order_id uuid not null references public.orders(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 event_type text not null check(event_type in('created','paid','shipped','delivered','cancelled','disputed','refunded','seller_released')),
 from_status text,to_status text,metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.marketplace_order_events enable row level security;
revoke all on public.marketplace_order_events from anon,authenticated;
grant select on public.marketplace_order_events to authenticated;
drop policy if exists marketplace_order_events_participants on public.marketplace_order_events;
create policy marketplace_order_events_participants on public.marketplace_order_events
for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and(o.buyer_id=auth.uid() or o.seller_id=auth.uid())));
create index if not exists marketplace_order_events_order_idx on public.marketplace_order_events(order_id,created_at desc);

alter table public.marketplace_deliveries
 add column if not exists last_location_at timestamptz,
 add column if not exists location_precision_m integer not null default 25,
 add column if not exists buyer_confirmed_at timestamptz;
revoke update on public.marketplace_deliveries from anon,authenticated;
revoke insert,update,delete on public.marketplace_delivery_agents from anon,authenticated;

create or replace function public.register_marketplace_delivery_agent(p_display_name text default null,p_phone text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); a public.marketplace_delivery_agents%rowtype;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 insert into public.marketplace_delivery_agents(user_id,display_name,phone,active)
 values(u,left(nullif(trim(p_display_name),''),120),left(nullif(trim(p_phone),''),32),true)
 on conflict(user_id) do update set display_name=coalesce(excluded.display_name,public.marketplace_delivery_agents.display_name),
 phone=coalesce(excluded.phone,public.marketplace_delivery_agents.phone),updated_at=now()
 returning * into a;
 if a.blocked_at is not null then return jsonb_build_object('ok',false,'blocked',true,'reason',a.blocked_reason); end if;
 return jsonb_build_object('ok',true,'active',a.active,'blocked',false);
end $$;
revoke all on function public.register_marketplace_delivery_agent(text,text) from public,anon;
grant execute on function public.register_marketplace_delivery_agent(text,text) to authenticated;

create or replace function public.place_marketplace_order(
 p_product_id uuid,p_quantity integer,p_idempotency_key text default null,
 p_delivery_mode text default 'seller_delivery',p_delivery_address text default null,p_delivery_note text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
 u uuid:=auth.uid(); p public.products%rowtype; w public.wallets%rowtype; oid uuid; old_oid uuid;
 fee bigint:=0; subtotal bigint; total bigint; debit numeric; before_balance numeric;
 wc text; pc text; payment_minor bigint; ua uuid; pa uuid; ledger_id uuid;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_idempotency_key is null or length(trim(p_idempotency_key))<16 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 if p_quantity not between 1 and 100 then raise exception 'INVALID_QUANTITY'; end if;
 if p_delivery_mode not in('pickup','seller_delivery','local_delivery') then raise exception 'INVALID_DELIVERY_MODE'; end if;
 if length(coalesce(p_delivery_address,''))>1000 or length(coalesce(p_delivery_note,''))>500 then raise exception 'INPUT_TOO_LONG'; end if;
 perform pg_advisory_xact_lock(hashtextextended('marketplace-checkout:'||u::text||':'||p_idempotency_key,0));
 select id into old_oid from public.orders where buyer_id=u and marketplace_idempotency_key=p_idempotency_key limit 1;
 if old_oid is not null then return old_oid; end if;

 select * into p from public.products where id=p_product_id for update;
 if not found or p.status<>'active' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
 if p.seller_id=u then raise exception 'SELF_PURCHASE_NOT_ALLOWED'; end if;
 if p.inventory_count<p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
 if p_delivery_mode='local_delivery' and not p.local_delivery then raise exception 'LOCAL_DELIVERY_UNAVAILABLE'; end if;
 if p_delivery_mode<>'pickup' and nullif(trim(coalesce(p_delivery_address,'')),'') is null then raise exception 'DELIVERY_ADDRESS_REQUIRED'; end if;
 fee:=case when p_delivery_mode='local_delivery' then coalesce(p.delivery_fee_minor,0) else 0 end;
 subtotal:=p.price_minor*p_quantity; total:=subtotal+fee; pc:=upper(coalesce(p.currency,'KES'));
 select * into w from public.wallets where user_id=u::text for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 if coalesce(w.status,'active')<>'active' or not coalesce(w.spending_enabled,true) then raise exception 'WALLET_SPENDING_DISABLED'; end if;
 wc:=upper(coalesce(w.currency,'KES'));
 if wc not in('KES','USD','EUR') or pc not in('KES','USD','EUR') then raise exception 'UNSUPPORTED_CURRENCY'; end if;
 debit:=case when wc=pc then round(total/100.0,2)
   when wc='USD' and pc='KES' then round((total/100.0)/130,2)
   when wc='KES' and pc='USD' then round((total/100.0)*130,2)
   when wc='EUR' and pc='KES' then round((total/100.0)/150,2)
   when wc='KES' and pc='EUR' then round((total/100.0)*150,2) else null end;
 if debit is null then raise exception 'UNSUPPORTED_CURRENCY_PAIR'; end if;
 before_balance:=coalesce(w.balance,0); if before_balance<debit then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
 payment_minor:=round(debit*100)::bigint;

 perform private.ensure_user_financial_accounts(u,wc);
 select id into ua from public.wallet_accounts where account_type='USER' and user_id=u and currency=wc limit 1;
 select id into pa from public.wallet_accounts where account_type='PLATFORM' and currency=wc limit 1;
 if pa is null then insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM',wc,'ACTIVE') returning id into pa; end if;
 oid:=gen_random_uuid();
 ledger_id:=private.post_wallet_ledger('MARKETPLACE_ESCROW_HOLD','marketplace_order',oid,
   'marketplace-hold:'||u::text||':'||p_idempotency_key,'Marketplace escrow hold',
   jsonb_build_array(jsonb_build_object('account_id',ua,'direction','DEBIT','amount_minor',payment_minor),
                     jsonb_build_object('account_id',pa,'direction','CREDIT','amount_minor',payment_minor)),
   jsonb_build_object('product_id',p.id,'delivery_fee_minor',fee));

 update public.wallets set balance=balance-debit,updated_at=now() where id=w.id;
 update public.products set inventory_count=inventory_count-p_quantity,stock=greatest(0,coalesce(stock,inventory_count)-p_quantity),
   sales_count=coalesce(sales_count,0)+p_quantity,updated_at=now() where id=p.id;
 insert into public.orders(id,buyer_id,seller_id,product_id,quantity,total_minor,currency,status,unit_price_minor,total_amount,
   payment_method,payment_reference,paid_at,created_at,updated_at,delivery_mode,delivery_fee_minor,delivery_address,delivery_note,
   delivery_status,escrow_status,payment_currency,payment_amount_minor,payment_ledger_transaction_id,marketplace_idempotency_key)
 values(oid,u,p.seller_id,p.id,p_quantity,total,pc,'confirmed',p.price_minor,round(total/100.0,2),'wallet',
   'MALL-'||upper(replace(gen_random_uuid()::text,'-','')),now(),now(),now(),p_delivery_mode,fee,
   nullif(trim(p_delivery_address),''),nullif(trim(p_delivery_note),''),'pending','held',wc,payment_minor,ledger_id,p_idempotency_key);
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,
   provider,provider_order_id,provider_reference,provider_status,description,metadata,payment_method,reference,transfer_id,
   counterparty_user_id,idempotency_key,completed_at,created_at,updated_at)
 values(w.id,u::text,'purchase','purchase',debit,payment_minor,wc,'out','completed',before_balance,before_balance-debit,
   'testagram_escrow',oid::text,'MALL-'||oid::text,'completed','Marketplace escrow hold',
   jsonb_build_object('order_id',oid,'escrow',true,'ledger_posted',true,'ledger_transaction_id',ledger_id),
   'wallet','marketplace:'||oid::text,oid,p.seller_id::text,'marketplace-hold:'||u::text||':'||p_idempotency_key,now(),now(),now());
 insert into public.marketplace_order_events(order_id,actor_id,event_type,to_status,metadata)
 values(oid,u,'created','confirmed',jsonb_build_object('escrow_status','held','payment_currency',wc));
 return oid;
end $$;

create or replace function public.advance_marketplace_order(p_order_id uuid,p_next_status text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare o public.orders%rowtype; u uuid:=auth.uid(); w public.wallets%rowtype;
 ua uuid; pa uuid; refund_ledger uuid; before_balance numeric; refund_amount numeric; pay_currency text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_next_status='shipped' then
   if o.seller_id<>u or o.status<>'confirmed' or o.escrow_status<>'held' then raise exception 'FORBIDDEN_OR_INVALID_TRANSITION'; end if;
   perform set_config('testagram.marketplace_transition','1',true);
   update public.orders set status='shipped',shipped_at=now(),updated_at=now() where id=o.id;
   insert into public.marketplace_order_events(order_id,actor_id,event_type,from_status,to_status,metadata)
   values(o.id,u,'shipped',o.status,'shipped','{}'::jsonb);
   return jsonb_build_object('ok',true,'status','shipped');
 elsif p_next_status='cancelled' then
   if o.buyer_id<>u and o.seller_id<>u then raise exception 'FORBIDDEN'; end if;
   if o.status<>'confirmed' or o.escrow_status<>'held' then raise exception 'ORDER_ALREADY_DISPATCHED'; end if;
   pay_currency:=upper(coalesce(o.payment_currency,o.currency,'KES'));
   refund_amount:=round(coalesce(o.payment_amount_minor,0)/100.0,2);
   if refund_amount<=0 then raise exception 'INVALID_ESCROW_AMOUNT'; end if;
   select * into w from public.wallets where user_id=o.buyer_id::text for update;
   if not found then raise exception 'BUYER_WALLET_NOT_FOUND'; end if;
   perform private.ensure_user_financial_accounts(o.buyer_id,pay_currency);
   select id into ua from public.wallet_accounts where account_type='USER' and user_id=o.buyer_id and currency=pay_currency limit 1;
   select id into pa from public.wallet_accounts where account_type='PLATFORM' and currency=pay_currency limit 1;
   if pa is null then raise exception 'PLATFORM_ACCOUNT_NOT_FOUND'; end if;
   refund_ledger:=private.post_wallet_ledger('MARKETPLACE_ESCROW_REFUND','marketplace_order',o.id,
     'marketplace-refund:'||o.id::text,'Marketplace escrow refund',
     jsonb_build_array(jsonb_build_object('account_id',pa,'direction','DEBIT','amount_minor',o.payment_amount_minor),
                       jsonb_build_object('account_id',ua,'direction','CREDIT','amount_minor',o.payment_amount_minor)),
     jsonb_build_object('reason',p_reason));
   before_balance:=coalesce(w.balance,0);
   update public.wallets set balance=balance+refund_amount,updated_at=now() where id=w.id;
   perform set_config('testagram.marketplace_transition','1',true);
   update public.orders set status='cancelled',cancelled_at=now(),cancellation_reason=left(nullif(trim(p_reason),''),500),
     escrow_status='refunded',updated_at=now() where id=o.id;
   insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,
     provider,provider_order_id,provider_reference,provider_status,description,metadata,payment_method,reference,transfer_id,
     counterparty_user_id,idempotency_key,completed_at,created_at,updated_at)
   values(w.id,o.buyer_id::text,'refund','refund',refund_amount,o.payment_amount_minor,pay_currency,'in','completed',before_balance,
     before_balance+refund_amount,'testagram_escrow',o.id::text,'REFUND-'||o.id::text,'completed','Marketplace escrow refund',
     jsonb_build_object('order_id',o.id,'ledger_posted',true,'ledger_transaction_id',refund_ledger),'wallet','refund:'||o.id::text,
     o.id,o.seller_id::text,'marketplace-refund:'||o.id::text,now(),now(),now());
   insert into public.marketplace_order_events(order_id,actor_id,event_type,from_status,to_status,metadata)
   values(o.id,u,'refunded',o.status,'cancelled',jsonb_build_object('ledger_transaction_id',refund_ledger));
   return jsonb_build_object('ok',true,'status','cancelled','refunded',true);
 else raise exception 'INVALID_ORDER_TRANSITION'; end if;
end $$;

create or replace function public.guard_marketplace_order_status()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if tg_op='UPDATE' and new.product_id is not null and old.status is distinct from new.status
    and current_setting('testagram.marketplace_transition',true)<>'1' then
   raise exception 'MARKETPLACE_STATUS_RPC_REQUIRED';
 end if;
 return new;
end $$;
drop trigger if exists marketplace_order_status_guard on public.orders;
create trigger marketplace_order_status_guard before update on public.orders
for each row execute function public.guard_marketplace_order_status();

create or replace function public.confirm_marketplace_delivery(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d public.marketplace_deliveries%rowtype; o public.orders%rowtype; a public.marketplace_delivery_agents%rowtype;
 sw public.wallets%rowtype; seller_account uuid; platform_account uuid; ledger_id uuid; seller_currency text;
 gross numeric; seller_credit numeric; seller_minor bigint; before_balance numeric;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into d from public.marketplace_deliveries where id=p_delivery_id and buyer_id=auth.uid() for update;
 if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
 if d.payment_status<>'paid' then raise exception 'DELIVERY_PAYMENT_NOT_VERIFIED'; end if;
 select * into o from public.orders where id=d.order_id for update;
 if not found or o.escrow_status<>'held' then return jsonb_build_object('ok',true,'already_complete',true); end if;
 if d.courier_id is null then raise exception 'COURIER_NOT_ASSIGNED'; end if;
 select * into a from public.marketplace_delivery_agents where user_id=d.courier_id for update;
 if not found or (not a.active and a.blocked_at is null) then raise exception 'COURIER_NOT_ACTIVE'; end if;

 gross:=round(o.unit_price_minor*o.quantity/100.0,2);
 seller_currency:=upper(coalesce((select currency from public.wallets where user_id=o.seller_id::text),o.currency,'KES'));
 seller_credit:=case when seller_currency=upper(o.currency) then gross
   when seller_currency='USD' and upper(o.currency)='KES' then round(gross/130,2)
   when seller_currency='KES' and upper(o.currency)='USD' then round(gross*130,2)
   when seller_currency='EUR' and upper(o.currency)='KES' then round(gross/150,2)
   when seller_currency='KES' and upper(o.currency)='EUR' then round(gross*150,2)
   else null end;
 if seller_credit is null then raise exception 'UNSUPPORTED_SELLER_CURRENCY_PAIR'; end if;
 seller_minor:=round(seller_credit*100)::bigint;

 perform set_config('testagram.marketplace_transition','1',true);
 update public.orders set status='delivered',delivered_at=now(),delivery_status='delivered',escrow_status='released',updated_at=now() where id=o.id;
 if a.blocked_at is null then
   select * into sw from public.wallets where user_id=o.seller_id::text for update;
   if not found then raise exception 'SELLER_WALLET_NOT_FOUND'; end if;
   perform private.ensure_user_financial_accounts(o.seller_id,seller_currency);
   select id into seller_account from public.wallet_accounts where account_type='USER' and user_id=o.seller_id and currency=seller_currency limit 1;
   select id into platform_account from public.wallet_accounts where account_type='PLATFORM' and currency=seller_currency limit 1;
   if platform_account is null then insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM',seller_currency,'ACTIVE') returning id into platform_account; end if;
   ledger_id:=private.post_wallet_ledger('MARKETPLACE_SELLER_RELEASE','marketplace_order',o.id,
     'marketplace-seller-release:'||o.id::text,'Marketplace escrow seller release',
     jsonb_build_array(jsonb_build_object('account_id',platform_account,'direction','DEBIT','amount_minor',seller_minor),
                       jsonb_build_object('account_id',seller_account,'direction','CREDIT','amount_minor',seller_minor)),
     jsonb_build_object('order_id',o.id,'seller_id',o.seller_id,'currency',seller_currency));
   before_balance:=coalesce(sw.balance,0);
   update public.wallets set balance=balance+seller_credit,updated_at=now() where id=sw.id;
   update public.orders set seller_payout_ledger_transaction_id=ledger_id,updated_at=now() where id=o.id;
   insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,
     provider,provider_order_id,provider_reference,provider_status,description,metadata,payment_method,reference,transfer_id,
     counterparty_user_id,idempotency_key,completed_at,created_at,updated_at)
   values(sw.id,o.seller_id::text,'sale','sale',seller_credit,seller_minor,seller_currency,'in','completed',before_balance,
     before_balance+seller_credit,'testagram_escrow',o.id::text,'SALE-'||o.id::text,'completed','Marketplace escrow seller release',
     jsonb_build_object('order_id',o.id,'ledger_posted',true,'ledger_transaction_id',ledger_id),'wallet','sale:'||o.id::text,
     o.id,o.buyer_id::text,'marketplace-seller-release:'||o.id::text,now(),now(),now());
 end if;
 update public.marketplace_deliveries set buyer_confirmed_at=now(),status='delivered',
   payout_status=case when a.blocked_at is null then 'pending' else 'blocked' end,updated_at=now() where id=d.id;
 insert into public.marketplace_order_events(order_id,actor_id,event_type,from_status,to_status,metadata)
 values(o.id,auth.uid(),'delivered',o.status,'delivered',jsonb_build_object('courier_blocked',a.blocked_at is not null,'seller_released',a.blocked_at is null));
 return jsonb_build_object('ok',true,'seller_released',a.blocked_at is null,'payout_status',case when a.blocked_at is null then 'pending' else 'blocked' end);
end $$;

revoke all on function public.place_marketplace_order(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.place_marketplace_order(uuid,integer,text,text,text,text) to authenticated;
revoke all on function public.advance_marketplace_order(uuid,text,text) from public,anon;
grant execute on function public.advance_marketplace_order(uuid,text,text) to authenticated;
revoke all on function public.confirm_marketplace_delivery(uuid) from public,anon;
grant execute on function public.confirm_marketplace_delivery(uuid) to authenticated;

commit;