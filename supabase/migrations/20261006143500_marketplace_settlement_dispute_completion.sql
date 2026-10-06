-- Marketplace settlement/dispute completion layer.
begin;

create or replace function public.update_marketplace_delivery_location(
 p_delivery_id uuid,p_lat double precision,p_lng double precision,p_status text default 'in_transit',p_eta_minutes integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
 if p_status not in('assigned','picked_up','in_transit','delivered') then raise exception 'INVALID_STATUS'; end if;
 if not exists(select 1 from public.marketplace_delivery_agents where user_id=auth.uid() and active and blocked_at is null) then raise exception 'DELIVERY_AGENT_BLOCKED_OR_NOT_ACTIVE'; end if;
 update public.marketplace_deliveries
 set status=p_status,courier_lat=p_lat,courier_lng=p_lng,courier_updated_at=now(),last_location_at=now(),
 eta_minutes=greatest(0,coalesce(p_eta_minutes,eta_minutes)),updated_at=now()
 where id=p_delivery_id and courier_id=auth.uid() and payment_status='paid' and status not in('delivered','cancelled');
 if not found then return false; end if;
 insert into public.marketplace_delivery_events(delivery_id,status,latitude,longitude,eta_minutes,note)
 values(p_delivery_id,p_status,p_lat,p_lng,p_eta_minutes,
 case when p_status='delivered' then 'Courier marked delivery complete; buyer confirmation remains required' else null end);
 perform public.marketplace_audit(null,p_delivery_id,auth.uid(),'delivery.status','success',jsonb_build_object('status',p_status));
 return true;
end $$;
grant execute on function public.update_marketplace_delivery_location(uuid,double precision,double precision,text,integer) to authenticated;

create or replace function public.resolve_marketplace_dispute(
 p_dispute_id uuid,p_resolution text,p_refund_amount_minor bigint default 0,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d public.marketplace_disputes%rowtype; o public.orders%rowtype;
 pa uuid; ba uuid; sa uuid; da uuid; buyer_wallet public.wallets%rowtype;
 refund_minor bigint; seller_minor bigint; courier_minor bigint; currency_code text; ledger_id uuid;
begin
 if u is null or not public.testagram_has_permission('marketplace.disputes.resolve') then raise exception 'FORBIDDEN'; end if;
 select * into d from public.marketplace_disputes where id=p_dispute_id for update;
 if not found then raise exception 'DISPUTE_NOT_FOUND'; end if;
 select * into o from public.orders where id=d.order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if d.status not in('open','investigating') then raise exception 'DISPUTE_ALREADY_RESOLVED'; end if;
 if p_resolution not in('refund','partial_refund','deny') then raise exception 'INVALID_RESOLUTION'; end if;
 currency_code:=upper(coalesce(o.payment_currency,o.currency,'KES'));
 if p_resolution='deny' then
  update public.marketplace_disputes set status='denied',resolution_note=left(p_note,4000),resolved_by=u,resolved_at=now(),updated_at=now() where id=d.id;
  update public.orders set escrow_status=case when seller_settlement_status='released' then 'released' else 'held' end,refund_status='none',updated_at=now() where id=o.id;
  perform public.marketplace_audit(o.id,d.delivery_id,u,'dispute.resolve','denied',jsonb_build_object('dispute_id',d.id));
  return jsonb_build_object('ok',true,'resolution','deny');
 end if;
 refund_minor:=case when p_resolution='refund' then o.payment_amount_minor else greatest(0,least(coalesce(p_refund_amount_minor,0),o.payment_amount_minor)) end;
 if refund_minor<=0 then raise exception 'REFUND_AMOUNT_REQUIRED'; end if;
 perform private.ensure_user_financial_accounts(o.buyer_id,currency_code);
 insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM',currency_code,'ACTIVE') on conflict do nothing;
 select id into pa from public.wallet_accounts where account_type='PLATFORM' and currency=currency_code for update;
 select id into ba from public.wallet_accounts where account_type='USER' and user_id=o.buyer_id and currency=currency_code for update;
 if pa is null or ba is null then raise exception 'FINANCIAL_ACCOUNTS_NOT_READY'; end if;

 if o.seller_settlement_status='released' then
  seller_minor:=coalesce(o.seller_settlement_amount_minor,o.unit_price_minor*o.quantity);
  perform private.ensure_user_financial_accounts(o.seller_id,currency_code);
  select id into sa from public.wallet_accounts where account_type='USER' and user_id=o.seller_id and currency=currency_code for update;
  if sa is null then raise exception 'SELLER_SETTLEMENT_ACCOUNT_NOT_FOUND'; end if;
  if (select coalesce(sum(case when le.direction='CREDIT' then le.amount_minor else -le.amount_minor end),0) from public.ledger_entries le where le.account_id=sa)<seller_minor then
    raise exception 'SELLER_FUNDS_ALREADY_WITHDRAWN_MANUAL_REVIEW';
  end if;
  perform private.post_wallet_ledger('MARKETPLACE_SELLER_CLAWBACK','marketplace_order',o.id,'marketplace-seller-clawback:'||o.id::text,
  'Marketplace seller dispute clawback',jsonb_build_array(jsonb_build_object('account_id',sa,'direction','DEBIT','amount_minor',seller_minor),
  jsonb_build_object('account_id',pa,'direction','CREDIT','amount_minor',seller_minor)),jsonb_build_object('dispute_id',d.id));
 end if;

 if d.delivery_id is not null then
  select courier_id into u from public.marketplace_deliveries where id=d.delivery_id;
  if u is not null then
   perform private.ensure_user_financial_accounts(u,currency_code);
   select id into da from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=u and currency=currency_code for update;
   select greatest(0,least(coalesce(round(e.net_amount*100)::bigint,0),
     coalesce((select sum(case when le.direction='CREDIT' then le.amount_minor else -le.amount_minor end) from public.ledger_entries le where le.account_id=da),0)))
   into courier_minor from public.marketplace_delivery_earnings e where e.delivery_id=d.delivery_id and e.status='available';
   if courier_minor>0 then
    perform private.post_wallet_ledger('MARKETPLACE_COURIER_CLAWBACK','marketplace_delivery',d.delivery_id,'marketplace-courier-clawback:'||d.delivery_id::text,
    'Marketplace courier dispute clawback',jsonb_build_array(jsonb_build_object('account_id',da,'direction','DEBIT','amount_minor',courier_minor),
    jsonb_build_object('account_id',pa,'direction','CREDIT','amount_minor',courier_minor)),jsonb_build_object('dispute_id',d.id));
    update public.marketplace_delivery_earnings set status='blocked',metadata=metadata||jsonb_build_object('clawed_back',true),updated_at=now()
    where delivery_id=d.delivery_id and status='available';
   end if;
  end if;
 end if;

 ledger_id:=private.post_wallet_ledger('MARKETPLACE_REFUND','marketplace_order',o.id,'marketplace-refund:'||o.id::text||':'||d.id::text,
 'Marketplace dispute refund',jsonb_build_array(jsonb_build_object('account_id',pa,'direction','DEBIT','amount_minor',refund_minor),
 jsonb_build_object('account_id',ba,'direction','CREDIT','amount_minor',refund_minor)),jsonb_build_object('dispute_id',d.id,'resolution',p_resolution));
 update public.wallets set balance=balance+round(refund_minor/100.0,2),updated_at=now()
 where user_id=o.buyer_id::text and upper(coalesce(currency,'KES'))=currency_code;
 insert into public.marketplace_refunds(order_id,dispute_id,buyer_id,amount_minor,currency,status,idempotency_key,ledger_transaction_id,reason,processed_at)
 values(o.id,d.id,o.buyer_id,refund_minor,currency_code,'processed','dispute-refund:'||d.id::text,ledger_id,p_note,now())
 on conflict(idempotency_key) do nothing;
 update public.marketplace_disputes set status='resolved_buyer',refund_amount_minor=refund_minor,resolution_note=left(p_note,4000),
 resolved_by=u,resolved_at=now(),updated_at=now() where id=d.id;
 update public.orders set escrow_status='refunded',refund_status='refunded',seller_settlement_status='refunded',updated_at=now() where id=o.id;
 if d.delivery_id is not null then update public.marketplace_deliveries set payout_status='blocked',updated_at=now() where id=d.delivery_id; end if;
 perform public.marketplace_audit(o.id,d.delivery_id,u,'dispute.resolve','refunded',jsonb_build_object('dispute_id',d.id,'refund_minor',refund_minor,'ledger_transaction_id',ledger_id));
 return jsonb_build_object('ok',true,'resolution',p_resolution,'refund_amount_minor',refund_minor,'ledger_transaction_id',ledger_id);
end $$;
grant execute on function public.resolve_marketplace_dispute(uuid,text,bigint,text) to authenticated;

create or replace function public.withdraw_marketplace_earnings()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); w public.wallets%rowtype; c text; e record; gross numeric; fee numeric; net numeric; da uuid; ua uuid; txid uuid; ledger_id uuid; before_balance numeric; out jsonb:='{"ok":true,"settlements":[]}'::jsonb;
begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into w from public.wallets where user_id=uid::text for update;
 if not found or not coalesce(w.withdrawals_enabled,false) then raise exception 'WITHDRAWALS_DISABLED'; end if;
 for c in select distinct currency from public.marketplace_delivery_earnings where courier_id=uid and status='available' loop
  gross:=0;fee:=0;net:=0;
  for e in select * from public.marketplace_delivery_earnings where courier_id=uid and status='available' and currency=c order by created_at for update loop
   gross:=gross+e.gross_amount;fee:=fee+e.platform_fee;net:=net+e.net_amount;
  end loop;
  if net<=0 then continue; end if;
  perform private.ensure_user_financial_accounts(uid,c);
  select id into da from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=uid and currency=c for update;
  select id into ua from public.wallet_accounts where account_type='USER' and user_id=uid and currency=c for update;
  ledger_id:=private.post_wallet_ledger('MARKETPLACE_EARNINGS_WITHDRAWAL','marketplace_earnings',uid,
  'marketplace-earnings-withdrawal:'||uid::text||':'||c||':'||md5(coalesce(string_agg(e.id::text,',' order by e.id),'')),
  'Release marketplace courier earnings',jsonb_build_array(jsonb_build_object('account_id',da,'direction','DEBIT','amount_minor',round(net*100)::bigint),
  jsonb_build_object('account_id',ua,'direction','CREDIT','amount_minor',round(net*100)::bigint)),jsonb_build_object('gross',gross,'platform_fee',fee,'net',net,'currency',c));
  if upper(coalesce(w.currency,'KES'))=c then
   before_balance:=coalesce(w.balance,0);
   update public.wallets set balance=balance+net,updated_at=now() where id=w.id;
   insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at,metadata)
   values(w.id,uid::text,'delivery_earnings_withdrawal','delivery_earnings_withdrawal',net,round(net*100)::bigint,c,'in','completed',before_balance,before_balance+net,'testagram_platform',
   'Marketplace delivery earnings withdrawal','wallet','delivery-earnings-withdrawal','marketplace-withdrawal:'||uid::text||':'||c||':'||ledger_id,now(),now(),now(),jsonb_build_object('ledger_transaction_id',ledger_id,'platform_fee',fee)) returning id into txid;
  else txid:=null; end if;
  update public.marketplace_delivery_earnings set status='withdrawn',withdrawal_transaction_id=coalesce(txid,ledger_id),withdrawn_at=now()
  where courier_id=uid and status='available' and currency=c;
  out:=out||jsonb_build_object('settlement',jsonb_build_object('currency',c,'gross_amount',gross,'platform_fee',fee,'net_amount',net,'ledger_transaction_id',ledger_id,'wallet_transaction_id',txid));
 end loop;
 return out;
end $$;
grant execute on function public.withdraw_marketplace_earnings() to authenticated;

commit;