-- Allow buyer confirmation to complete a delivery even when the courier was
-- suspended for a payment-policy violation; the delivery completes but the
-- courier payout remains blocked until platform review.
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
  if not found then raise exception 'COURIER_NOT_ACTIVE'; end if;
  if not v_agent.active and v_agent.blocked_at is null then raise exception 'COURIER_NOT_ACTIVE'; end if;

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
    return jsonb_build_object('ok',true,'payout_status','blocked','congratulations',false,'reason','COURIER_PAYMENT_POLICY_BLOCK');
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