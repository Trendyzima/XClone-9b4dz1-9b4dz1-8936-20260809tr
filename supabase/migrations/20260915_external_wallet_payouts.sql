create or replace function public.reserve_external_withdrawal(
 p_user_id uuid,p_wallet_id uuid,p_amount numeric,p_currency text,p_provider text,p_provider_reference text,p_destination text
) returns uuid language plpgsql security definer set search_path=public as $$
declare w public.wallets; tx uuid; v_amount numeric:=round(p_amount,2); v_currency text:=upper(coalesce(p_currency,''));
begin
 if current_user <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 if p_user_id is null or p_wallet_id is null or v_amount<=0 or v_currency='' or nullif(btrim(p_provider),'') is null or nullif(btrim(p_provider_reference),'') is null or nullif(btrim(p_destination),'') is null then raise exception 'invalid_payout_request' using errcode='22023'; end if;
 select * into w from public.wallets where id=p_wallet_id and user_id=p_user_id for update;
 if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
 if coalesce(w.status,'')<>'active' or coalesce(w.spending_enabled,true)=false or coalesce(w.withdrawals_enabled,true)=false then raise exception 'withdrawals_disabled' using errcode='42501'; end if;
 if upper(coalesce(w.currency,''))<>v_currency then raise exception 'wallet_currency_mismatch' using errcode='22023'; end if;
 if coalesce(w.balance,0)<v_amount then raise exception 'insufficient_balance' using errcode='22003'; end if;
 update public.wallets set balance=balance-v_amount,balance_cents=round((balance-v_amount)*100),updated_at=now() where id=w.id;
 insert into public.wallet_transactions(user_id,wallet_id,kind,type,amount,amount_cents,currency,direction,status,provider,provider_reference,provider_status,payment_method,description,metadata,balance_before,balance_after)
 values(p_user_id,w.id,'adjustment','withdrawal',v_amount,round(v_amount*100),v_currency,'debit','pending',lower(p_provider),p_provider_reference,'RESERVED',lower(p_provider),'External payout to '||left(p_destination,254),jsonb_build_object('destination',p_destination,'provider',lower(p_provider),'reserved_at',now()),w.balance,w.balance-v_amount) returning id into tx;
 return tx;
end $$;
revoke all on function public.reserve_external_withdrawal(uuid,uuid,numeric,text,text,text,text) from public;
grant execute on function public.reserve_external_withdrawal(uuid,uuid,numeric,text,text,text,text) to service_role;

create or replace function public.mark_external_withdrawal_processing(p_transaction_id uuid,p_provider_order_id text,p_provider_status text,p_provider_data jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if current_user <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 update public.wallet_transactions set provider_order_id=p_provider_order_id,provider_status=left(coalesce(p_provider_status,'PROCESSING'),255),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('provider_data',coalesce(p_provider_data,'{}'::jsonb)),updated_at=now() where id=p_transaction_id and status='pending';
end $$;
revoke all on function public.mark_external_withdrawal_processing(uuid,text,text,jsonb) from public;
grant execute on function public.mark_external_withdrawal_processing(uuid,text,text,jsonb) to service_role;

create or replace function public.finalize_external_withdrawal(p_transaction_id uuid,p_success boolean,p_provider_order_id text,p_provider_status text,p_provider_data jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path=public as $$
declare tx public.wallet_transactions; w public.wallets;
begin
 if current_user <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 select * into tx from public.wallet_transactions where id=p_transaction_id for update;
 if not found or tx.status<>'pending' then return; end if;
 if p_success then
   update public.wallet_transactions set status='completed',provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_status=left(coalesce(p_provider_status,'COMPLETED'),255),completed_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('provider_data',coalesce(p_provider_data,'{}'::jsonb)) where id=tx.id;
   update public.wallets set total_withdrawn=coalesce(total_withdrawn,0)+tx.amount,updated_at=now() where id=tx.wallet_id;
 else
   select * into w from public.wallets where id=tx.wallet_id for update;
   if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
   update public.wallets set balance=balance+tx.amount,balance_cents=round((balance+tx.amount)*100),updated_at=now() where id=w.id;
   update public.wallet_transactions set status='refunded',provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_status=left(coalesce(p_provider_status,'REFUNDED'),255),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('provider_data',coalesce(p_provider_data,'{}'::jsonb),'refunded_at',now()),updated_at=now() where id=tx.id;
 end if;
end $$;
revoke all on function public.finalize_external_withdrawal(uuid,boolean,text,text,jsonb) from public;
grant execute on function public.finalize_external_withdrawal(uuid,boolean,text,text,jsonb) to service_role;
