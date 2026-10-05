CREATE OR REPLACE FUNCTION public.wallet_pay_ride(p_ride_id uuid, p_amount numeric, p_currency text DEFAULT 'KES'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid:=auth.uid(); v_wallet public.wallets%rowtype; v_ride public.rides%rowtype; v_tx public.wallet_transactions%rowtype; v_txid uuid; v_key text;
 v_existing_ride uuid; v_risk integer:=0; v_reasons jsonb:='[]'::jsonb; v_recent_15m integer:=0; v_recent_24h integer:=0; v_amount_24h numeric:=0; v_pin_set boolean:=false;
 v_fare numeric; v_platform_fee numeric; v_driver_payout numeric; v_mpesa_fee numeric; v_total_charge numeric;
 v_user_account uuid; v_driver_account uuid; v_platform_account uuid; v_cost_account uuid; v_ledger_id uuid;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if p_ride_id is null or p_amount is null or p_amount<=0 then raise exception 'Invalid ride payment'; end if;
 if upper(coalesce(p_currency,''))<>'KES' then raise exception 'Ride wallet payments currently require KES'; end if;
 v_key:=nullif(trim(coalesce(p_idempotency_key,'')),'');
 if v_key is null or length(v_key)<8 or length(v_key)>128 or v_key !~ '^[A-Za-z0-9:_-]+$' then raise exception 'A valid idempotency key is required'; end if;
 select * into v_ride from public.rides where id=p_ride_id and user_id=v_uid for update;
 if not found then raise exception 'Ride not found'; end if;
 if v_ride.status<>'completed' then raise exception 'Ride is not completed'; end if;
 if v_ride.fare is null or abs(v_ride.fare::numeric-p_amount)>0.01 then raise exception 'Ride fare mismatch'; end if;
 v_fare:=round(v_ride.fare::numeric,2); v_platform_fee:=round(v_fare*0.10,2); v_driver_payout:=round(v_fare-v_platform_fee,2);
 if v_driver_payout>250000 then raise exception 'Ride payout exceeds M-Pesa B2C maximum'; end if;
 v_mpesa_fee:=public.mpesa_b2c_registered_business_fee_kes(v_driver_payout); v_total_charge:=round(v_fare+v_platform_fee+v_mpesa_fee,2);
 select exists(select 1 from public.wallet_security where user_id=v_uid and pin_hash is not null) into v_pin_set;
 if exists(select 1 from public.wallet_transactions where user_id=v_uid::text and metadata->>'ride_id'=p_ride_id::text and status='completed') then raise exception 'Ride has already been paid'; end if;
 select * into v_tx from public.wallet_transactions where user_id=v_uid::text and idempotency_key=v_key limit 1;
 if found then
   v_existing_ride:=nullif(v_tx.metadata->>'ride_id','')::uuid;
   if coalesce(v_tx.amount,0)<>v_total_charge or upper(coalesce(v_tx.currency,''))<>upper(p_currency) or v_existing_ride is distinct from p_ride_id then raise exception 'Idempotency key conflict'; end if;
   return jsonb_build_object('ok',true,'duplicate',true,'transaction_id',v_tx.id,'status',v_tx.status,'amount',v_total_charge,'currency',v_tx.currency,'fare',v_fare,'platform_fee',v_platform_fee,'mpesa_b2c_fee',v_mpesa_fee,'driver_payout',v_driver_payout);
 end if;
 select count(*) into v_recent_15m from public.wallet_transactions where user_id=v_uid::text and kind='ride_payment' and direction='debit' and status='completed' and created_at>=now()-interval '15 minutes';
 select count(*) into v_recent_24h from public.wallet_transactions where user_id=v_uid::text and kind='ride_payment' and direction='debit' and status='completed' and created_at>=now()-interval '24 hours';
 select coalesce(sum(abs(amount)),0) into v_amount_24h from public.wallet_transactions where user_id=v_uid::text and kind='ride_payment' and direction='debit' and status='completed' and created_at>=now()-interval '24 hours';
 if v_total_charge>=100000 then v_risk:=v_risk+70; v_reasons:=v_reasons||jsonb_build_array('high_amount'); elsif v_total_charge>=50000 then v_risk:=v_risk+40; v_reasons:=v_reasons||jsonb_build_array('elevated_amount'); end if;
 if v_recent_15m>=3 then v_risk:=v_risk+50; v_reasons:=v_reasons||jsonb_build_array('ride_velocity_15m'); end if;
 if v_recent_24h>=8 then v_risk:=v_risk+30; v_reasons:=v_reasons||jsonb_build_array('ride_velocity_24h'); end if;
 if v_amount_24h+v_total_charge>200000 then v_risk:=v_risk+40; v_reasons:=v_reasons||jsonb_build_array('daily_ride_value'); end if;
 if not v_pin_set and v_total_charge>=50000 then v_risk:=v_risk+35; v_reasons:=v_reasons||jsonb_build_array('high_value_without_wallet_pin'); end if;
 if v_risk>=70 then
   insert into public.wallet_risk_events(user_id,operation,amount,currency,reference_id,idempotency_key,decision,risk_score,reason_codes,metadata)
   values(v_uid,'ride_payment',v_total_charge,p_currency,p_ride_id,v_key,'block',least(v_risk,100),v_reasons,jsonb_build_object('fare',v_fare,'platform_fee',v_platform_fee,'mpesa_b2c_fee',v_mpesa_fee,'driver_payout',v_driver_payout,'recent_15m',v_recent_15m,'recent_24h',v_recent_24h,'amount_24h',v_amount_24h,'pin_set',v_pin_set));
   return jsonb_build_object('ok',false,'blocked',true,'code','RISK_BLOCKED','risk_score',least(v_risk,100),'reason_codes',v_reasons);
 end if;
 select * into v_wallet from public.wallets where user_id=v_uid::text for update;
 if not found then raise exception 'Wallet not found'; end if;
 if coalesce(v_wallet.status,'active')<>'active' or coalesce(v_wallet.spending_enabled,true)=false then raise exception 'Wallet spending is disabled'; end if;
 if v_wallet.balance<v_total_charge then raise exception 'Insufficient wallet balance'; end if;
 if coalesce(v_wallet.spend_limit_enabled,false) and v_wallet.daily_spend_limit is not null and coalesce((select sum(abs(amount)) from public.wallet_transactions where user_id=v_uid::text and direction='debit' and status='completed' and created_at>=date_trunc('day',now())),0)+v_total_charge>v_wallet.daily_spend_limit then raise exception 'Daily wallet spending limit exceeded'; end if;
 perform private.ensure_user_financial_accounts(v_uid,'KES');
 select id into v_user_account from public.wallet_accounts where account_type='USER' and user_id=v_uid and currency='KES';
 select id into v_driver_account from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=v_ride.driver_id and currency='KES';
 if v_driver_account is null and v_ride.driver_id is not null then perform private.ensure_user_financial_accounts(v_ride.driver_id,'KES'); select id into v_driver_account from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=v_ride.driver_id and currency='KES'; end if;
 select id into v_platform_account from public.wallet_accounts where account_type='PLATFORM' and currency='KES' limit 1;
 select id into v_cost_account from public.wallet_accounts where account_type='MPESA_COST_RESERVE' and currency='KES' limit 1;
 if v_user_account is null or v_driver_account is null or v_platform_account is null or v_cost_account is null then raise exception 'FINANCIAL_ACCOUNTS_NOT_READY'; end if;
 v_ledger_id:=private.post_wallet_ledger('RIDE_PAYMENT','ride',p_ride_id,'ride-ledger:'||v_key,'Ride settlement',jsonb_build_array(
   jsonb_build_object('account_id',v_user_account,'direction','DEBIT','amount_minor',round(v_total_charge*100)::bigint),
   jsonb_build_object('account_id',v_driver_account,'direction','CREDIT','amount_minor',round(v_driver_payout*100)::bigint),
   jsonb_build_object('account_id',v_platform_account,'direction','CREDIT','amount_minor',round(v_platform_fee*100)::bigint),
   jsonb_build_object('account_id',v_cost_account,'direction','CREDIT','amount_minor',round(v_mpesa_fee*100)::bigint)
 ),jsonb_build_object('ride_id',p_ride_id,'fare',v_fare,'platform_fee',v_platform_fee,'driver_payout',v_driver_payout,'mpesa_b2c_fee',v_mpesa_fee));
 update public.wallets set balance=balance-v_total_charge,updated_at=now() where id=v_wallet.id;
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at,metadata)
 values(v_wallet.id,v_uid::text,'ride_payment','ride_payment',v_total_charge,p_currency,'debit','completed',v_wallet.balance,v_wallet.balance-v_total_charge,'testagram_wallet','Ride payment + 10% platform fee + M-Pesa B2C cost reserve','wallet','ride:'||p_ride_id::text,v_key,now(),now(),now(),jsonb_build_object('ride_id',p_ride_id,'fare',v_fare,'platform_fee',v_platform_fee,'mpesa_b2c_fee',v_mpesa_fee,'driver_payout',v_driver_payout,'fee_rate',0.10,'mpesa_tariff','B2C registered-user business charge','safaricom_cost_reserved',v_mpesa_fee,'risk_score',v_risk,'ledger_posted',true,'ledger_transaction_id',v_ledger_id)) returning id into v_txid;
 insert into public.wallet_ledger(wallet_id,user_id,direction,amount_minor,currency,reason,reference_type,reference_id,idempotency_key,metadata)
 values(v_wallet.id,v_uid::text,'debit',round(v_total_charge*100)::bigint,p_currency,'ride_payment','ride',p_ride_id,v_key,jsonb_build_object('wallet_transaction_id',v_txid,'fare',v_fare,'platform_fee',v_platform_fee,'mpesa_b2c_fee',v_mpesa_fee,'driver_payout',v_driver_payout,'safaricom_cost_reserved',v_mpesa_fee,'risk_score',v_risk));
 insert into public.wallet_risk_events(user_id,operation,amount,currency,reference_id,idempotency_key,decision,risk_score,reason_codes,metadata)
 values(v_uid,'ride_payment',v_total_charge,p_currency,p_ride_id,v_key,'allow',v_risk,v_reasons,jsonb_build_object('fare',v_fare,'platform_fee',v_platform_fee,'mpesa_b2c_fee',v_mpesa_fee,'driver_payout',v_driver_payout,'recent_15m',v_recent_15m,'recent_24h',v_recent_24h,'amount_24h',v_amount_24h,'pin_set',v_pin_set));
 return jsonb_build_object('ok',true,'duplicate',false,'transaction_id',v_txid,'status','completed','amount',v_total_charge,'currency',p_currency,'fare',v_fare,'platform_fee',v_platform_fee,'mpesa_b2c_fee',v_mpesa_fee,'driver_payout',v_driver_payout,'safaricom_cost_reserved',v_mpesa_fee,'risk_score',v_risk);
end $function$;


revoke all on function public.wallet_pay_ride(uuid,numeric,text,text) from public,anon;
grant execute on function public.wallet_pay_ride(uuid,numeric,text,text) to authenticated;
