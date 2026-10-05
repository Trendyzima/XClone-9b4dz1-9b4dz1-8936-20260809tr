-- Canonical settlement rewiring for marketplace, delivery earnings, and direct M-Pesa ads.
begin;
CREATE OR REPLACE FUNCTION public.confirm_marketplace_delivery(p_delivery_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d public.marketplace_deliveries%rowtype;
  a public.marketplace_delivery_agents%rowtype;
  da public.wallet_accounts%rowtype;
  pa public.wallet_accounts%rowtype;
  gross numeric;
  fee numeric;
  net numeric;
  currency_code text;
  earning_id uuid;
  ledger_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into d from public.marketplace_deliveries where id=p_delivery_id and buyer_id=auth.uid() for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  if d.payment_status<>'paid' then raise exception 'DELIVERY_PAYMENT_NOT_VERIFIED'; end if;
  if d.courier_id is null then raise exception 'COURIER_NOT_ASSIGNED'; end if;
  if d.status in ('delivered','cancelled') then
    return jsonb_build_object('ok',true,'already_complete',true,'payout_status',d.payout_status);
  end if;
  select * into a from public.marketplace_delivery_agents where user_id=d.courier_id for update;
  if not found or (not a.active and a.blocked_at is null) then raise exception 'COURIER_NOT_ACTIVE'; end if;
  if a.blocked_at is not null then
    update public.marketplace_deliveries set status='delivered',payout_status='blocked',updated_at=now() where id=d.id;
    update public.orders set delivery_status='delivered',delivered_at=now(),updated_at=now() where id=d.order_id;
    insert into public.marketplace_delivery_events(delivery_id,status,note)
    values(d.id,'delivered','Buyer confirmed delivery; courier payout blocked by risk controls');
    return jsonb_build_object('ok',true,'payout_status','blocked','congratulations',false,'reason','COURIER_PAYMENT_POLICY_BLOCK');
  end if;

  gross:=round(d.delivery_fee_minor/100.0,2);
  if gross<=0 then
    update public.marketplace_deliveries set status='delivered',payout_status='paid',updated_at=now() where id=d.id;
    update public.orders set delivery_status='delivered',delivered_at=now(),updated_at=now() where id=d.order_id;
    return jsonb_build_object('ok',true,'payout_status','paid','gross_amount',0,'platform_fee',0,'withdrawable_amount',0);
  end if;
  fee:=round(gross*0.10,2);
  net:=round(gross-fee,2);
  currency_code:='KES';

  perform public.ensure_user_financial_accounts(d.courier_id);
  select * into da from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=d.courier_id and currency='KES' for update;
  select * into pa from public.wallet_accounts where account_type='PLATFORM' and currency='KES' for update;
  if pa.id is null then
    insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM','KES','ACTIVE') on conflict do nothing;
    select * into pa from public.wallet_accounts where account_type='PLATFORM' and currency='KES' for update;
  end if;

  ledger_id:=public.post_balanced_ledger_transaction(
    'MARKETPLACE_DELIVERY_SETTLEMENT','marketplace_delivery',d.id,
    'marketplace-delivery-settlement:'||d.id::text,
    'Marketplace delivery settlement: 90% courier / 10% platform',
    jsonb_build_array(
      jsonb_build_object('account_id',pa.id,'direction','DEBIT','amount_minor',round(gross*100)::bigint,
        'metadata',jsonb_build_object('component','delivery_gross')),
      jsonb_build_object('account_id',da.id,'direction','CREDIT','amount_minor',round(net*100)::bigint,
        'metadata',jsonb_build_object('component','courier_payable','courier_id',d.courier_id)),
      jsonb_build_object('account_id',pa.id,'direction','CREDIT','amount_minor',round(fee*100)::bigint,
        'metadata',jsonb_build_object('component','platform_fee','rate',0.10))
    ),
    jsonb_build_object('delivery_id',d.id,'gross',gross,'platform_fee',fee,'net',net)
  );

  insert into public.marketplace_delivery_earnings(
    delivery_id,courier_id,gross_amount,platform_fee,net_amount,currency,status,metadata
  ) values(
    d.id,d.courier_id,gross,fee,net,currency_code,'available',
    jsonb_build_object('platform_fee_rate',0.10,'source','delivery_confirmation','ledger_transaction_id',ledger_id)
  )
  on conflict(delivery_id) do nothing returning id into earning_id;

  update public.marketplace_deliveries
    set status='delivered',payout_status='pending',updated_at=now()
    where id=d.id;
  update public.orders set delivery_status='delivered',delivered_at=now(),updated_at=now() where id=d.order_id;
  insert into public.marketplace_delivery_events(delivery_id,status,note)
  values(d.id,'delivered','Buyer confirmed delivery; ledger settlement posted');

  return jsonb_build_object('ok',true,'payout_status','pending','gross_amount',gross,
    'platform_fee',fee,'platform_fee_rate',0.10,'withdrawable_amount',net,
    'ledger_transaction_id',ledger_id,'congratulations',true);
end
$function$


CREATE OR REPLACE FUNCTION public.finalize_testagram_ad_mpesa_payment(p_checkout_request_id text, p_result_code integer, p_receipt_number text, p_result_description text, p_amount_kes numeric, p_callback_data jsonb DEFAULT '{}'::jsonb, p_provider_response jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.testagram_ad_payments%rowtype;
  c public.testagram_ad_campaigns%rowtype;
  a public.testagram_advertisers%rowtype;
  ledger_id uuid;
  spend_amount numeric;
begin
  if nullif(btrim(p_checkout_request_id),'') is null then return jsonb_build_object('ok',false,'reason','checkout_request_id_required'); end if;
  select * into p from public.testagram_ad_payments where checkout_request_id=p_checkout_request_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','payment_not_found'); end if;
  select * into c from public.testagram_ad_campaigns where id=p.campaign_id for update;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  select * into a from public.testagram_advertisers where id=c.advertiser_id for share;
  if not found or a.owner_user_id is distinct from p.user_id then raise exception 'CAMPAIGN_NOT_OWNED'; end if;
  if p.status='completed' then return jsonb_build_object('ok',true,'idempotent',true,'status','completed','ad_id',p.campaign_id,'activated',c.status='active'); end if;

  if p_result_code<>0 then
    update public.testagram_ad_payments set status='failed',result_code=p_result_code,result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),provider_response=coalesce(p_provider_response,'{}'::jsonb) where id=p.id and status='pending';
    if p.mpesa_payment_id is not null then
      update public.mpesa_payments set status='failed',result_code=p_result_code,result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),updated_at=now() where id=p.mpesa_payment_id and status='pending';
    end if;
    return jsonb_build_object('ok',true,'status','failed','ad_id',p.campaign_id,'result_code',p_result_code);
  end if;

  if p_receipt_number is null or length(trim(p_receipt_number))=0 then raise exception 'MPESA_RECEIPT_REQUIRED'; end if;
  if p_amount_kes is null or round(p_amount_kes::numeric,2)<>round(p.amount_kes::numeric,2) then raise exception 'MPESA_AMOUNT_MISMATCH'; end if;
  if upper(c.currency)<>'KES' then raise exception 'AD_BILLING_CURRENCY_MUST_BE_KES'; end if;
  spend_amount:=round(coalesce(c.lifetime_budget_micros,0)/1000000.0,2);
  if spend_amount<=0 or round(spend_amount,2)<>round(p.amount_kes,2) then raise exception 'CAMPAIGN_PAYMENT_AMOUNT_MISMATCH'; end if;

  insert into public.wallet_accounts(account_type,currency,status) values('MPESA_CLEARING','KES','ACTIVE') on conflict do nothing;
  insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM','KES','ACTIVE') on conflict do nothing;
  ledger_id:=public.post_balanced_ledger_transaction(
    'AD_FUNDING','ad_campaign',p.campaign_id,'ad-funding:'||p.id::text,
    'M-Pesa ad campaign funding',
    jsonb_build_array(
      jsonb_build_object('account_id',(select id from public.wallet_accounts where account_type='MPESA_CLEARING' and currency='KES'),
        'direction','DEBIT','amount_minor',round(spend_amount*100)::bigint,
        'metadata',jsonb_build_object('receipt',p_receipt_number,'checkout_request_id',p_checkout_request_id)),
      jsonb_build_object('account_id',(select id from public.wallet_accounts where account_type='PLATFORM' and currency='KES'),
        'direction','CREDIT','amount_minor',round(spend_amount*100)::bigint,
        'metadata',jsonb_build_object('campaign_id',p.campaign_id,'receipt',p_receipt_number))
    ),
    jsonb_build_object('campaign_id',p.campaign_id,'mpesa_receipt_number',p_receipt_number)
  );

  update public.testagram_ad_campaigns
    set payment_status='funded',payment_reference=p_receipt_number,funded_micros=lifetime_budget_micros,
        status=case when starts_at<=now() and (ends_at is null or ends_at>=now()) then 'active' else 'pending_payment' end,
        updated_at=now()
  where id=p.campaign_id and advertiser_id=c.advertiser_id and payment_status<>'funded';

  if not found and c.payment_status<>'funded' then raise exception 'CAMPAIGN_ACTIVATION_UPDATE_FAILED'; end if;

  update public.testagram_ad_payments
    set status='completed',result_code=0,result_description=p_result_description,mpesa_receipt_number=p_receipt_number,
        callback_data=coalesce(p_callback_data,'{}'::jsonb),provider_response=coalesce(p_provider_response,'{}'::jsonb),
        updated_at=now()
  where id=p.id;

  if p.mpesa_payment_id is not null then
    update public.mpesa_payments set status='completed',result_code=0,receipt_number=coalesce(p_receipt_number,receipt_number),
      result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),completed_at=now(),updated_at=now()
    where id=p.mpesa_payment_id and status='pending';
  end if;

  return jsonb_build_object('ok',true,'idempotent',false,'status','completed','ad_id',p.campaign_id,'activated',true,
    'receipt_number',p_receipt_number,'ledger_transaction_id',ledger_id);
end
$function$


CREATE OR REPLACE FUNCTION public.place_marketplace_order(p_product_id uuid, p_quantity integer, p_idempotency_key text DEFAULT NULL::text, p_delivery_mode text DEFAULT 'seller_delivery'::text, p_delivery_address text DEFAULT NULL::text, p_delivery_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid:=auth.uid();
  v_product public.products%rowtype;
  v_order_id uuid:=gen_random_uuid();
  v_key text:=nullif(left(trim(coalesce(p_idempotency_key,'')),120),'');
  v_product_kes numeric;
  v_delivery_kes numeric:=0;
  v_total_kes numeric;
  v_seller_credit numeric;
  v_buyer_tx jsonb;
  v_seller_tx jsonb;
  v_currency text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_product_id is null then raise exception 'PRODUCT_REQUIRED'; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>100 then raise exception 'INVALID_QUANTITY'; end if;
  if p_delivery_mode not in ('pickup','seller_delivery','local_delivery') then raise exception 'INVALID_DELIVERY_MODE'; end if;
  if v_key is null or length(v_key)<8 or v_key !~ '^[A-Za-z0-9:_-]+$' then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  select (wt.metadata->>'order_id')::uuid into v_order_id
  from public.wallet_transactions wt
  where wt.user_id=uid::text and wt.kind='purchase_charge'
    and wt.idempotency_key=v_key limit 1;
  if v_order_id is not null then return v_order_id; end if;
  v_order_id:=gen_random_uuid();

  select * into v_product from public.products where id=p_product_id for update;
  if not found or v_product.status<>'active' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if v_product.seller_id=uid then raise exception 'SELF_PURCHASE_NOT_ALLOWED'; end if;
  if v_product.inventory_count<p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
  if p_delivery_mode='local_delivery' and not coalesce(v_product.local_delivery,false) then raise exception 'LOCAL_DELIVERY_UNAVAILABLE'; end if;
  if p_delivery_mode<>'pickup' and nullif(trim(coalesce(p_delivery_address,'')),'') is null then raise exception 'DELIVERY_ADDRESS_REQUIRED'; end if;
  if p_delivery_mode='local_delivery' then v_delivery_kes:=round(coalesce(v_product.delivery_fee_minor,0)/100.0,2); end if;

  v_currency:=upper(coalesce(v_product.currency,'KES'));
  if v_currency='KES' then
    v_product_kes:=round(v_product.price_minor*p_quantity/100.0,2);
  elsif v_currency='USD' then
    v_product_kes:=round((v_product.price_minor*p_quantity/100.0)*130,2);
    v_delivery_kes:=round(v_delivery_kes*130,2);
  else
    raise exception 'UNSUPPORTED_CURRENCY';
  end if;
  v_total_kes:=round(v_product_kes+v_delivery_kes,2);
  v_seller_credit:=v_product_kes;

  v_buyer_tx:=private.wallet_charge_platform_kes(
    v_total_kes,'purchase',v_order_id,v_key,'Testagram Mall purchase',
    jsonb_build_object('product_id',v_product.id,'seller_id',v_product.seller_id,
      'product_total_kes',v_product_kes,'delivery_fee_kes',v_delivery_kes,'source_currency',v_currency,
      'fx_rate_kes_per_usd',case when v_currency='USD' then 130 else 1 end)
  );
  v_seller_tx:=private.wallet_credit_user_from_platform_kes(
    v_product.seller_id,v_seller_credit,'marketplace_sale',v_order_id,
    'marketplace-sale:'||v_order_id::text,'Testagram Mall seller proceeds',
    jsonb_build_object('product_id',v_product.id,'buyer_id',uid,'source_currency',v_currency,
      'product_total_kes',v_product_kes,'fx_rate_kes_per_usd',case when v_currency='USD' then 130 else 1 end)
  );

  update public.products
    set inventory_count=inventory_count-p_quantity,
        stock=greatest(0,coalesce(stock,inventory_count)-p_quantity),
        sales_count=coalesce(sales_count,0)+p_quantity,updated_at=now()
  where id=v_product.id;

  insert into public.orders(
    id,buyer_id,seller_id,product_id,quantity,total_minor,currency,status,unit_price_minor,
    total_amount,payment_method,payment_reference,paid_at,created_at,updated_at,
    delivery_mode,delivery_fee_minor,delivery_address,delivery_note,delivery_status
  ) values(
    v_order_id,uid,v_product.seller_id,v_product.id,p_quantity,
    v_product.price_minor*p_quantity + case when p_delivery_mode='local_delivery' then v_product.delivery_fee_minor else 0 end,
    v_product.currency,'confirmed',v_product.price_minor,
    round((v_product.price_minor*p_quantity + case when p_delivery_mode='local_delivery' then v_product.delivery_fee_minor else 0 end)/100.0,2),
    'wallet',v_buyer_tx->>'wallet_transaction_id',now(),now(),now(),
    p_delivery_mode,v_product.delivery_fee_minor,nullif(trim(p_delivery_address),''),nullif(trim(p_delivery_note),''),'pending'
  );

  insert into public.creator_earnings(creator_id,source_type,source_id,amount,currency,status,user_id,source)
  values(v_product.seller_id,'marketplace_sale',v_order_id,v_product_kes,'KES','paid',v_product.seller_id,'marketplace_sale');

  return v_order_id;
end
$function$


CREATE OR REPLACE FUNCTION public.withdraw_marketplace_earnings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid:=auth.uid();
  w public.wallets%rowtype;
  da public.wallet_accounts%rowtype;
  gross numeric:=0;
  net numeric:=0;
  fee numeric:=0;
  txid uuid;
  ledger_id uuid;
  e record;
  payable_balance numeric;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into w from private.wallet_normalize_kes_wallet(uid);
  if coalesce(w.withdrawals_enabled,false)=false then raise exception 'WITHDRAWALS_DISABLED'; end if;
  perform public.ensure_user_financial_accounts(uid);
  select * into da from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=uid and currency='KES' for update;
  if da.id is null then raise exception 'NO_DRIVER_EARNINGS_ACCOUNT'; end if;

  for e in
    select * from public.marketplace_delivery_earnings
    where courier_id=uid and status='available' and currency='KES'
    order by created_at for update
  loop
    gross:=gross+e.gross_amount;
    fee:=fee+e.platform_fee;
    net:=net+e.net_amount;
  end loop;
  if net<=0 then raise exception 'NO_WITHDRAWABLE_EARNINGS'; end if;

  select coalesce(sum(case when le.direction='CREDIT' then le.amount_minor else -le.amount_minor end),0)/100.0
    into payable_balance from public.ledger_entries le where le.account_id=da.id;
  if payable_balance<net then raise exception 'DRIVER_PAYABLE_BALANCE_MISMATCH'; end if;

  ledger_id:=public.post_balanced_ledger_transaction(
    'MARKETPLACE_EARNINGS_WITHDRAWAL','marketplace_earnings',uid,
    'marketplace-earnings-withdrawal:'||uid::text||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),
    'Release marketplace courier earnings to user Wallet',
    jsonb_build_array(
      jsonb_build_object('account_id',da.id,'direction','DEBIT','amount_minor',round(net*100)::bigint,
        'metadata',jsonb_build_object('component','driver_payable_release')),
      jsonb_build_object('account_id',(select id from public.wallet_accounts where account_type='USER' and user_id=uid and currency='KES'),
        'direction','CREDIT','amount_minor',round(net*100)::bigint,
        'metadata',jsonb_build_object('component','user_wallet','courier_id',uid))
    ),
    jsonb_build_object('gross',gross,'platform_fee',fee,'net',net)
  );

  update public.wallets set balance=balance+net,updated_at=now() where id=w.id;
  insert into public.wallet_transactions(
    wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,
    balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,
    completed_at,created_at,updated_at,metadata
  ) values(
    w.id,uid::text,'delivery_earnings_withdrawal','delivery_earnings_withdrawal',net,round(net*100)::bigint,
    'KES','credit','completed',w.balance,w.balance+net,'testagram_platform',
    'Marketplace delivery earnings withdrawal','wallet','delivery-earnings-withdrawal',
    'marketplace-earnings-withdrawal:'||uid::text||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),
    now(),now(),now(),jsonb_build_object('gross',gross,'platform_fee',fee,'net',net,'ledger_transaction_id',ledger_id)
  ) returning id into txid;

  update public.marketplace_delivery_earnings
    set status='withdrawn',withdrawal_transaction_id=txid,withdrawn_at=now()
  where courier_id=uid and status='available' and currency='KES';

  return jsonb_build_object('ok',true,'gross_amount',gross,'platform_fee',fee,
    'platform_fee_rate',0.10,'net_amount',net,'currency','KES',
    'wallet_transaction_id',txid,'ledger_transaction_id',ledger_id);
end
$function$

commit;
