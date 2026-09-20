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

create or replace function public.place_marketplace_order(p_product_id uuid,p_quantity integer,p_idempotency_key text default null,p_delivery_mode text default 'seller_delivery',p_delivery_address text default null,p_delivery_note text default null)
returns uuid language plpgsql security definer set search_path to ''
as $$
declare b uuid:=auth.uid(); p public.products%rowtype; bw public.wallets%rowtype; sw public.wallets%rowtype; oid uuid:=gen_random_uuid(); ref text:='MALL-'||upper(replace(gen_random_uuid()::text,'-','')); fee bigint:=0; subtotal bigint; total bigint; debit numeric; credit numeric; bb numeric; sb numeric; bc text; sc text; pc text; fx numeric:=130;
begin
 if b is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_quantity<1 or p_quantity>100 then raise exception 'INVALID_QUANTITY'; end if;
 if p_delivery_mode not in ('pickup','seller_delivery','local_delivery') then raise exception 'INVALID_DELIVERY_MODE'; end if;
 select * into p from public.products where id=p_product_id for update;
 if not found or p.status<>'active' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
 if p.seller_id=b then raise exception 'SELF_PURCHASE_NOT_ALLOWED'; end if;
 if p.inventory_count<p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
 if p_delivery_mode='local_delivery' and not p.local_delivery then raise exception 'LOCAL_DELIVERY_UNAVAILABLE'; end if;
 if p_delivery_mode<>'pickup' and nullif(trim(coalesce(p_delivery_address,'')),'') is null then raise exception 'DELIVERY_ADDRESS_REQUIRED'; end if;
 fee:=case when p_delivery_mode='local_delivery' then coalesce(p.delivery_fee_minor,0) else 0 end;
 subtotal:=p.price_minor*p_quantity; total:=subtotal+fee; pc:=upper(coalesce(p.currency,'KES')); 
 if b::text<p.seller_id::text then select * into bw from public.wallets where user_id=b::text for update; select * into sw from public.wallets where user_id=p.seller_id::text for update; else select * into sw from public.wallets where user_id=p.seller_id::text for update; select * into bw from public.wallets where user_id=b::text for update; end if;
 if bw.id is null then raise exception 'WALLET_NOT_FOUND'; end if;
 if sw.id is null then insert into public.wallets(user_id,balance,currency,status,spending_enabled,withdrawals_enabled) values(p.seller_id::text,0,pc,'active',true,true) on conflict(user_id) do nothing; select * into sw from public.wallets where user_id=p.seller_id::text for update; end if;
 if coalesce(bw.status,'active')<>'active' or not coalesce(bw.spending_enabled,true) then raise exception 'WALLET_SPENDING_DISABLED'; end if;
 if coalesce(sw.status,'active')<>'active' then raise exception 'SELLER_WALLET_DISABLED'; end if;
 bc:=upper(coalesce(bw.currency,'USD')); sc:=upper(coalesce(sw.currency,pc));
 if bc not in ('USD','KES') or sc not in ('USD','KES') or pc not in ('USD','KES') then raise exception 'UNSUPPORTED_CURRENCY'; end if;
 debit:=case when bc=pc then round(total/100.0,2) when bc='USD' and pc='KES' then round((total/100.0)/fx,2) else round((total/100.0)*fx,2) end;
 credit:=case when sc=pc then round(subtotal/100.0,2) when sc='USD' and pc='KES' then round((subtotal/100.0)/fx,2) else round((subtotal/100.0)*fx,2) end;
 bb:=coalesce(bw.balance,0); sb:=coalesce(sw.balance,0); if bb<debit then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
 update public.wallets set balance=balance-debit,updated_at=now() where id=bw.id;
 update public.wallets set balance=balance+credit,updated_at=now() where id=sw.id;
 update public.products set inventory_count=inventory_count-p_quantity,stock=greatest(0,coalesce(stock,inventory_count)-p_quantity),sales_count=coalesce(sales_count,0)+p_quantity,updated_at=now() where id=p.id;
 insert into public.orders(id,buyer_id,seller_id,product_id,quantity,total_minor,currency,status,unit_price_minor,total_amount,payment_method,payment_reference,paid_at,created_at,updated_at,delivery_mode,delivery_fee_minor,delivery_address,delivery_note,delivery_status) values(oid,b,p.seller_id,p.id,p_quantity,total,pc,'confirmed',p.price_minor,round(total/100.0,2),'wallet',ref,now(),now(),now(),p_delivery_mode,fee,nullif(trim(p_delivery_address),''),nullif(trim(p_delivery_note),''),'pending');
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,provider_order_id,provider_reference,provider_status,description,metadata,payment_method,reference,transfer_id,counterparty_user_id,idempotency_key,completed_at) values(bw.id,b::text,'purchase','purchase',debit,round(debit*100)::bigint,bc,'out','completed',bb,bb-debit,'internal',oid::text,ref,'completed','Testagram Mall purchase',jsonb_build_object('order_id',oid,'delivery_fee_minor',fee),'wallet',ref,oid,p.seller_id::text,p_idempotency_key,now());
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,provider_order_id,provider_reference,provider_status,description,metadata,payment_method,reference,transfer_id,counterparty_user_id,completed_at) values(sw.id,p.seller_id::text,'purchase','purchase',credit,round(credit*100)::bigint,sc,'in','completed',sb,sb+credit,'internal',oid::text,ref,'completed','Testagram Mall sale',jsonb_build_object('order_id',oid,'delivery_fee_minor',fee),'wallet',ref,oid,b::text,now());
 return oid;
end $$;
grant execute on function public.place_marketplace_order(uuid,integer,text,text,text,text) to authenticated;
