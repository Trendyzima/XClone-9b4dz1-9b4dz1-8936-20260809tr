-- Marketplace order/delivery hardening: reservations, seller trust, verified delivery,
-- disputes/refunds, security audit, and server-side escrow release guards.
-- This migration is intentionally additive; monetary settlement remains on the
-- canonical wallet/ledger functions already present in this repository.

begin;

create table if not exists public.marketplace_inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'held' check (status in ('held','committed','released','expired')),
  idempotency_key text not null,
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  unique (buyer_id,idempotency_key)
);
create index if not exists marketplace_inventory_reservations_product_status_idx
  on public.marketplace_inventory_reservations(product_id,status,expires_at);
create index if not exists marketplace_inventory_reservations_buyer_idx
  on public.marketplace_inventory_reservations(buyer_id,created_at desc);
alter table public.marketplace_inventory_reservations enable row level security;
revoke all on public.marketplace_inventory_reservations from anon,authenticated;
grant select on public.marketplace_inventory_reservations to authenticated;
drop policy if exists marketplace_inventory_reservations_participant_read on public.marketplace_inventory_reservations;
create policy marketplace_inventory_reservations_participant_read on public.marketplace_inventory_reservations
for select to authenticated using ((select auth.uid())=buyer_id or exists(
  select 1 from public.orders o where o.id=order_id and o.seller_id=(select auth.uid())
));

create table if not exists public.marketplace_seller_trust (
  seller_id uuid primary key references auth.users(id) on delete cascade,
  score numeric(5,2) not null default 0 check(score between 0 and 100),
  status text not null default 'new' check(status in ('new','standard','trusted','restricted')),
  completed_orders integer not null default 0,
  cancelled_orders integer not null default 0,
  disputed_orders integer not null default 0,
  verified boolean not null default false,
  last_calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.marketplace_seller_trust enable row level security;
revoke all on public.marketplace_seller_trust from anon,authenticated;
grant select on public.marketplace_seller_trust to authenticated;
drop policy if exists marketplace_seller_trust_read on public.marketplace_seller_trust;
create policy marketplace_seller_trust_read on public.marketplace_seller_trust
for select to authenticated using(true);

create table if not exists public.marketplace_security_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  delivery_id uuid references public.marketplace_deliveries(id) on delete set null,
  action text not null,
  outcome text not null default 'success',
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists marketplace_security_audit_order_idx on public.marketplace_security_audit(order_id,created_at desc);
create index if not exists marketplace_security_audit_actor_idx on public.marketplace_security_audit(actor_id,created_at desc);
alter table public.marketplace_security_audit enable row level security;
revoke all on public.marketplace_security_audit from anon,authenticated;
grant select on public.marketplace_security_audit to authenticated;
create policy marketplace_security_audit_participant_read on public.marketplace_security_audit
for select to authenticated using(
  (select auth.uid())=actor_id or exists(
    select 1 from public.orders o where o.id=order_id and (o.buyer_id=(select auth.uid()) or o.seller_id=(select auth.uid()))
  )
);

create table if not exists public.marketplace_order_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  opened_by uuid not null references auth.users(id),
  reason text not null check(reason in ('not_received','wrong_item','damaged','not_as_described','fraud','other')),
  description text not null,
  status text not null default 'open' check(status in ('open','under_review','resolved_refund','resolved_release','rejected','manual_review')),
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketplace_order_disputes_status_idx on public.marketplace_order_disputes(status,created_at);
alter table public.marketplace_order_disputes enable row level security;
revoke all on public.marketplace_order_disputes from anon,authenticated;
grant select,insert on public.marketplace_order_disputes to authenticated;
create policy marketplace_order_disputes_read on public.marketplace_order_disputes for select to authenticated using(
  exists(select 1 from public.orders o where o.id=order_id and (o.buyer_id=(select auth.uid()) or o.seller_id=(select auth.uid())))
);
create policy marketplace_order_disputes_buyer_open on public.marketplace_order_disputes for insert to authenticated
with check(opened_by=(select auth.uid()) and exists(select 1 from public.orders o where o.id=order_id and o.buyer_id=(select auth.uid())));

alter table public.marketplace_deliveries
  add column if not exists delivery_code_hash text,
  add column if not exists delivery_code_issued_at timestamptz,
  add column if not exists delivery_code_expires_at timestamptz,
  add column if not exists delivery_code_attempts integer not null default 0,
  add column if not exists delivery_verified_at timestamptz,
  add column if not exists buyer_confirmed_at timestamptz;
alter table public.orders
  add column if not exists buyer_confirmation_deadline timestamptz,
  add column if not exists seller_settled_at timestamptz;

create or replace function public.refresh_marketplace_seller_trust(p_seller_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare total_orders integer; completed_orders integer; cancelled_orders integer; disputed_orders integer;
  verified boolean; age_days integer; score numeric; status text;
begin
  select coalesce(p.verified,false),greatest(0,current_date-coalesce(p.created_at::date,current_date))
    into verified,age_days from public.profiles p where p.id=p_seller_id;
  if not found then raise exception 'SELLER_NOT_FOUND'; end if;
  select count(*)::int into total_orders from public.orders where seller_id=p_seller_id;
  select count(*)::int into completed_orders from public.orders where seller_id=p_seller_id and status='delivered';
  select count(*)::int into cancelled_orders from public.orders where seller_id=p_seller_id and status='cancelled';
  select count(*)::int into disputed_orders from public.marketplace_order_disputes d join public.orders o on o.id=d.order_id where o.seller_id=p_seller_id;
  score:=20
    +case when verified then 15 else 0 end
    +least(35,completed_orders*2)
    +least(10,age_days/3.0)
    +case when total_orders=0 then 0 else greatest(0,least(10,10-(cancelled_orders::numeric/greatest(1,total_orders))*100)) end
    +case when completed_orders=0 then 0 else greatest(0,least(10,10-(disputed_orders::numeric/greatest(1,completed_orders))*100)) end;
  score:=round(greatest(0,least(100,score)),2);
  status:=case
    when disputed_orders>=3 and disputed_orders::numeric/greatest(1,completed_orders)>0.10 then 'restricted'
    when score>=70 and completed_orders>=3 then 'trusted'
    when completed_orders>0 then 'standard' else 'new' end;
  insert into public.marketplace_seller_trust(seller_id,score,status,completed_orders,cancelled_orders,disputed_orders,verified,last_calculated_at,updated_at)
  values(p_seller_id,score,status,completed_orders,cancelled_orders,disputed_orders,verified,now(),now())
  on conflict(seller_id) do update set score=excluded.score,status=excluded.status,completed_orders=excluded.completed_orders,
    cancelled_orders=excluded.cancelled_orders,disputed_orders=excluded.disputed_orders,verified=excluded.verified,
    last_calculated_at=now(),updated_at=now();
  return jsonb_build_object('seller_id',p_seller_id,'score',score,'status',status,
    'completed_orders',completed_orders,'cancelled_orders',cancelled_orders,'disputed_orders',disputed_orders,'verified',verified);
end
$$;
revoke execute on function public.refresh_marketplace_seller_trust(uuid) from public,anon;
grant execute on function public.refresh_marketplace_seller_trust(uuid) to authenticated;

create or replace function public.get_marketplace_seller_trust(p_seller_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare r public.marketplace_seller_trust%rowtype;
begin
  select * into r from public.marketplace_seller_trust where seller_id=p_seller_id;
  if not found or r.last_calculated_at<now()-interval '15 minutes' then return public.refresh_marketplace_seller_trust(p_seller_id); end if;
  return jsonb_build_object('seller_id',r.seller_id,'score',r.score,'status',r.status,
    'completed_orders',r.completed_orders,'cancelled_orders',r.cancelled_orders,'disputed_orders',r.disputed_orders,'verified',r.verified);
end
$$;
revoke execute on function public.get_marketplace_seller_trust(uuid) from public,anon;
grant execute on function public.get_marketplace_seller_trust(uuid) to authenticated;

create or replace function public.issue_marketplace_delivery_code(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d public.marketplace_deliveries%rowtype; code text; expires timestamptz;
begin
  select * into d from public.marketplace_deliveries where id=p_delivery_id and buyer_id=auth.uid() for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  if d.payment_status<>'paid' or d.status in ('delivered','cancelled') then raise exception 'INVALID_DELIVERY_STATE'; end if;
  code:=lpad((floor(random()*1000000))::int::text,6,'0'); expires:=now()+interval '60 minutes';
  update public.marketplace_deliveries set delivery_code_hash=crypt(code,gen_salt('bf')),
    delivery_code_issued_at=now(),delivery_code_expires_at=expires,delivery_code_attempts=0,updated_at=now() where id=d.id;
  insert into public.marketplace_security_audit(actor_id,order_id,delivery_id,action,metadata)
  values(auth.uid(),d.order_id,d.id,'DELIVERY_CODE_ISSUED',jsonb_build_object('expires_at',expires));
  return jsonb_build_object('ok',true,'code',code,'expires_at',expires);
end
$$;
revoke execute on function public.issue_marketplace_delivery_code(uuid) from public,anon;
grant execute on function public.issue_marketplace_delivery_code(uuid) to authenticated;

create or replace function public.verify_marketplace_delivery_code(p_delivery_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d public.marketplace_deliveries%rowtype;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'INVALID_DELIVERY_CODE'; end if;
  select * into d from public.marketplace_deliveries where id=p_delivery_id and courier_id=auth.uid() for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  if d.payment_status<>'paid' or d.status not in ('assigned','picked_up','in_transit') then raise exception 'INVALID_DELIVERY_STATE'; end if;
  if d.delivery_code_hash is null or d.delivery_code_expires_at<now() then raise exception 'DELIVERY_CODE_EXPIRED'; end if;
  if d.delivery_code_attempts>=5 then raise exception 'DELIVERY_CODE_LOCKED'; end if;
  if crypt(p_code,d.delivery_code_hash)<>d.delivery_code_hash then
    update public.marketplace_deliveries set delivery_code_attempts=delivery_code_attempts+1,updated_at=now() where id=d.id;
    raise exception 'INVALID_DELIVERY_CODE';
  end if;
  update public.marketplace_deliveries set status='delivered',delivery_verified_at=now(),
    delivery_code_hash=null,delivery_code_expires_at=null,updated_at=now() where id=d.id;
  update public.orders set delivery_status='delivered',delivered_at=coalesce(delivered_at,now()),updated_at=now() where id=d.order_id;
  insert into public.marketplace_delivery_events(delivery_id,status,note) values(d.id,'delivered','Courier verified buyer delivery code');
  insert into public.marketplace_security_audit(actor_id,order_id,delivery_id,action,metadata)
  values(auth.uid(),d.order_id,d.id,'DELIVERY_VERIFIED',jsonb_build_object('method','buyer_code'));
  return jsonb_build_object('ok',true,'status','delivered');
end
$$;
revoke execute on function public.verify_marketplace_delivery_code(uuid,text) from public,anon;
grant execute on function public.verify_marketplace_delivery_code(uuid,text) to authenticated;

create or replace function public.open_marketplace_dispute(p_order_id uuid,p_reason text,p_description text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare o public.orders%rowtype; did uuid;
begin
  select * into o from public.orders where id=p_order_id and (buyer_id=auth.uid() or seller_id=auth.uid()) for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if p_reason not in ('not_received','wrong_item','damaged','not_as_described','fraud','other') then raise exception 'INVALID_DISPUTE_REASON'; end if;
  if length(trim(coalesce(p_description,'')))<10 or length(p_description)>4000 then raise exception 'INVALID_DISPUTE_DESCRIPTION'; end if;
  if exists(select 1 from public.marketplace_order_disputes where order_id=o.id) then raise exception 'DISPUTE_ALREADY_EXISTS'; end if;
  insert into public.marketplace_order_disputes(order_id,opened_by,reason,description) values(o.id,auth.uid(),p_reason,left(trim(p_description),4000)) returning id into did;
  perform set_config('testagram.marketplace_transition','1',true);
  update public.orders set escrow_status=case when escrow_status='held' then 'disputed' else escrow_status end,updated_at=now() where id=o.id;
  insert into public.marketplace_order_events(order_id,actor_id,event_type,to_status,metadata)
  values(o.id,auth.uid(),'dispute_opened',o.status,o.status,jsonb_build_object('dispute_id',did,'reason',p_reason));
  insert into public.marketplace_security_audit(actor_id,order_id,action,metadata)
  values(auth.uid(),o.id,'DISPUTE_OPENED',jsonb_build_object('dispute_id',did,'reason',p_reason));
  return jsonb_build_object('ok',true,'dispute_id',did,'status','open');
end
$$;
revoke execute on function public.open_marketplace_dispute(uuid,text,text) from public,anon;
grant execute on function public.open_marketplace_dispute(uuid,text,text) to authenticated;

create or replace function public.guard_marketplace_delivery_release()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.escrow_status='released' and old.escrow_status is distinct from new.escrow_status
     and new.delivery_mode in ('seller_delivery','local_delivery')
     and not exists(select 1 from public.marketplace_deliveries d where d.order_id=new.id and d.delivery_verified_at is not null)
  then raise exception 'DELIVERY_VERIFICATION_REQUIRED'; end if;
  return new;
end
$$;
revoke all on function public.guard_marketplace_delivery_release() from public,anon,authenticated;
drop trigger if exists marketplace_delivery_release_guard on public.orders;
create trigger marketplace_delivery_release_guard before update of escrow_status on public.orders
for each row execute function public.guard_marketplace_delivery_release();

create or replace function public.release_marketplace_inventory_on_cancel()
returns trigger language plpgsql security definer set search_path=''
as $$
declare r public.marketplace_inventory_reservations%rowtype;
begin
  if old.status is distinct from new.status and new.status='cancelled' then
    select * into r from public.marketplace_inventory_reservations where order_id=new.id and status='committed' for update;
    if found then
      update public.products set inventory_count=inventory_count+r.quantity,stock=coalesce(stock,0)+r.quantity,updated_at=now() where id=r.product_id;
      update public.marketplace_inventory_reservations set status='released',released_at=now() where id=r.id;
      insert into public.marketplace_security_audit(actor_id,order_id,action,metadata)
      values(auth.uid(),new.id,'INVENTORY_RELEASED_ON_CANCEL',jsonb_build_object('reservation_id',r.id,'quantity',r.quantity));
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.release_marketplace_inventory_on_cancel() from public,anon,authenticated;
drop trigger if exists marketplace_inventory_release_on_cancel on public.orders;
create trigger marketplace_inventory_release_on_cancel after update of status on public.orders
for each row when(old.status is distinct from new.status and new.status='cancelled')
execute function public.release_marketplace_inventory_on_cancel();

-- Existing checkout already creates the reservation. This fallback trigger makes
-- the reservation invariant durable if another server-side order writer is added.
create or replace function public.ensure_marketplace_inventory_reservation()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  begin
    insert into public.marketplace_inventory_reservations(product_id,order_id,buyer_id,quantity,status,idempotency_key,expires_at,committed_at)
    values(new.product_id,new.id,new.buyer_id,new.quantity,'committed',coalesce(new.marketplace_idempotency_key,new.id::text),now()+interval '30 days',now());
  exception when unique_violation then null;
  end;
  return new;
end
$$;
revoke all on function public.ensure_marketplace_inventory_reservation() from public,anon,authenticated;
drop trigger if exists marketplace_inventory_reservation_fallback on public.orders;
create trigger marketplace_inventory_reservation_fallback after insert on public.orders
for each row when(new.product_id is not null)
execute function public.ensure_marketplace_inventory_reservation();

create or replace function public.resolve_marketplace_dispute(
  p_dispute_id uuid,p_resolution text,p_note text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare d public.marketplace_order_disputes%rowtype; o public.orders%rowtype;
  w public.wallets%rowtype; ua uuid; pa uuid; ledger_id uuid; before_balance numeric; refund_amount numeric; pay_currency text;
begin
  if auth.uid() is null or not public.testagram_is_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if p_resolution not in ('refund_buyer','release_seller','reject') then raise exception 'INVALID_DISPUTE_RESOLUTION'; end if;
  select * into d from public.marketplace_order_disputes where id=p_dispute_id for update;
  if not found then raise exception 'DISPUTE_NOT_FOUND'; end if;
  select * into o from public.orders where id=d.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if d.status not in ('open','under_review','manual_review') then
    return jsonb_build_object('ok',true,'already_resolved',true,'status',d.status);
  end if;

  if p_resolution='refund_buyer' then
    if o.escrow_status<>'disputed' or o.payment_amount_minor is null then
      update public.marketplace_order_disputes set status='manual_review',
        resolution_note='Refund requires manual financial reconciliation because escrow is no longer held.',
        resolved_by=auth.uid(),resolved_at=now(),updated_at=now() where id=d.id;
      return jsonb_build_object('ok',false,'status','manual_review');
    end if;
    pay_currency:=upper(coalesce(o.payment_currency,o.currency,'KES'));
    select * into w from public.wallets where user_id=o.buyer_id::text for update;
    if not found then raise exception 'BUYER_WALLET_NOT_FOUND'; end if;
    perform private.ensure_user_financial_accounts(o.buyer_id,pay_currency);
    select id into ua from public.wallet_accounts where account_type='USER' and user_id=o.buyer_id and currency=pay_currency limit 1;
    select id into pa from public.wallet_accounts where account_type='PLATFORM' and currency=pay_currency limit 1;
    if ua is null or pa is null then raise exception 'FINANCIAL_ACCOUNTS_NOT_READY'; end if;
    refund_amount:=round(o.payment_amount_minor/100.0,2);
    before_balance:=coalesce(w.balance,0);
    ledger_id:=private.post_wallet_ledger('MARKETPLACE_DISPUTE_REFUND','marketplace_order',o.id,
      'marketplace-dispute-refund:'||o.id::text,'Marketplace dispute refund',
      jsonb_build_array(jsonb_build_object('account_id',pa,'direction','DEBIT','amount_minor',o.payment_amount_minor),
                        jsonb_build_object('account_id',ua,'direction','CREDIT','amount_minor',o.payment_amount_minor)),
      jsonb_build_object('dispute_id',d.id,'reason',d.reason));
    update public.wallets set balance=balance+refund_amount,updated_at=now() where id=w.id;
    perform set_config('testagram.marketplace_transition','1',true);
    update public.orders set status='cancelled',escrow_status='refunded',cancelled_at=coalesce(cancelled_at,now()),
      cancellation_reason='DISPUTE_REFUND',updated_at=now() where id=o.id;
    update public.marketplace_order_disputes set status='resolved_refund',
      resolution_note=left(coalesce(p_note,'Refund approved'),1000),resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
      where id=d.id;
    insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,
      balance_before,balance_after,provider,provider_order_id,provider_reference,provider_status,description,metadata,
      payment_method,reference,transfer_id,counterparty_user_id,idempotency_key,completed_at,created_at,updated_at)
    values(w.id,o.buyer_id::text,'refund','refund',refund_amount,o.payment_amount_minor,pay_currency,'in','completed',
      before_balance,before_balance+refund_amount,'testagram_escrow',o.id::text,'DISPUTE-REFUND-'||o.id::text,'completed',
      'Marketplace dispute refund',jsonb_build_object('dispute_id',d.id,'ledger_transaction_id',ledger_id),'wallet',
      'dispute-refund:'||o.id::text,o.id,o.seller_id::text,'marketplace-dispute-refund:'||o.id::text,now(),now(),now());
    insert into public.marketplace_security_audit(actor_id,order_id,action,metadata)
    values(auth.uid(),o.id,'DISPUTE_RESOLVED_REFUND',jsonb_build_object('dispute_id',d.id,'ledger_transaction_id',ledger_id));
    return jsonb_build_object('ok',true,'status','resolved_refund','ledger_transaction_id',ledger_id);
  elsif p_resolution='release_seller' then
    if o.escrow_status<>'disputed' then raise exception 'ESCROW_NOT_DISPUTED'; end if;
    perform set_config('testagram.marketplace_transition','1',true);
    update public.orders set escrow_status='held',updated_at=now() where id=o.id;
    update public.marketplace_order_disputes set status='resolved_release',
      resolution_note=left(coalesce(p_note,'Release approved'),1000),resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
      where id=d.id;
    return jsonb_build_object('ok',true,'status','resolved_release');
  else
    perform set_config('testagram.marketplace_transition','1',true);
    update public.orders set escrow_status=case when escrow_status='disputed' then 'held' else escrow_status end,updated_at=now() where id=o.id;
    update public.marketplace_order_disputes set status='rejected',
      resolution_note=left(coalesce(p_note,'Dispute rejected'),1000),resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
      where id=d.id;
    return jsonb_build_object('ok',true,'status','rejected');
  end if;
end
$$;
revoke execute on function public.resolve_marketplace_dispute(uuid,text,text) from public,anon;
grant execute on function public.resolve_marketplace_dispute(uuid,text,text) to authenticated;

commit;
