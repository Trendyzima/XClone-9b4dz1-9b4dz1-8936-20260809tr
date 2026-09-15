create or replace function public.reserve_mpesa_withdrawal(p_user_id uuid,p_wallet_id uuid,p_amount numeric,p_currency text,p_phone text,p_amount_kes numeric,p_client_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_wallet public.wallets; v_before numeric; v_after numeric; v_tx public.wallet_transactions; v_amount numeric:=round(p_amount::numeric,2); v_currency text:=upper(coalesce(p_currency,'USD'));
begin
 if p_user_id is null or p_wallet_id is null or v_amount<=0 or p_amount_kes<=0 or nullif(btrim(p_phone),'') is null or nullif(btrim(p_client_reference),'') is null then raise exception 'invalid_withdrawal_request' using errcode='22023'; end if;
 select * into v_wallet from public.wallets where id=p_wallet_id and user_id=p_user_id for update;
 if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
 if coalesce(v_wallet.status,'')<>'active' or coalesce(v_wallet.withdrawals_enabled,true)=false then raise exception 'withdrawals_disabled' using errcode='42501'; end if;
 if upper(coalesce(v_wallet.currency,'USD'))<>v_currency then raise exception 'wallet_currency_mismatch' using errcode='22023'; end if;
 v_before:=coalesce(v_wallet.balance,0); if v_before < v_amount then raise exception 'insufficient_balance' using errcode='22003'; end if; v_after:=v_before-v_amount;
 update public.wallets set balance=v_after,balance_cents=round(v_after*100),updated_at=now() where id=v_wallet.id;
 insert into public.wallet_transactions(user_id,wallet_id,kind,type,amount,amount_cents,currency,direction,status,provider,provider_reference,provider_status,payment_method,description,metadata,balance_before,balance_after)
 values(p_user_id,p_wallet_id,'adjustment','withdrawal',v_amount,round(v_amount*100),v_currency,'debit','pending','mpesa',p_client_reference,'PENDING','mpesa','M-Pesa withdrawal to '||p_phone,jsonb_build_object('phone',p_phone,'amount_kes',p_amount_kes,'client_reference',p_client_reference,'reserved_at',now()),v_before,v_after)
 returning * into v_tx;
 return jsonb_build_object('ok',true,'transaction_id',v_tx.id,'client_reference',p_client_reference,'balance_before',v_before,'balance_after',v_after,'amount',v_amount,'currency',v_currency);
end; $$;

create or replace function public.finalize_mpesa_withdrawal(p_client_reference text,p_provider_order_id text,p_result_code integer,p_transaction_id text,p_result_description text,p_result_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tx public.wallet_transactions; v_wallet public.wallets; v_refund_before numeric; v_refund_after numeric;
begin
 select * into v_tx from public.wallet_transactions where provider='mpesa' and type='withdrawal' and provider_reference=p_client_reference for update;
 if not found then raise exception 'withdrawal_not_found' using errcode='P0002'; end if;
 if v_tx.status='completed' then return jsonb_build_object('ok',true,'idempotent',true,'status','completed','transaction_id',v_tx.id); end if;
 if v_tx.status='refunded' then return jsonb_build_object('ok',true,'idempotent',true,'status','refunded','transaction_id',v_tx.id); end if;
 if p_result_code=0 then
   update public.wallet_transactions set status='completed',provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_capture_id=coalesce(p_transaction_id,provider_capture_id),provider_status='COMPLETED',completed_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_result_data,'{}'::jsonb)||jsonb_build_object('mpesa_transaction_id',p_transaction_id,'result_description',p_result_description) where id=v_tx.id;
   update public.wallets set total_withdrawn=coalesce(total_withdrawn,0)+v_tx.amount,updated_at=now() where id=v_tx.wallet_id;
   return jsonb_build_object('ok',true,'status','completed','transaction_id',v_tx.id);
 end if;
 select * into v_wallet from public.wallets where id=v_tx.wallet_id for update; if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
 v_refund_before:=coalesce(v_wallet.balance,0); v_refund_after:=v_refund_before+v_tx.amount;
 update public.wallets set balance=v_refund_after,balance_cents=round(v_refund_after*100),updated_at=now() where id=v_wallet.id;
 update public.wallet_transactions set status='refunded',balance_before=v_tx.balance_after,balance_after=v_refund_after,provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_status=coalesce(p_result_description,'FAILED'),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_result_data,'{}'::jsonb)||jsonb_build_object('refund_reason',p_result_description,'refunded_at',now()) where id=v_tx.id;
 return jsonb_build_object('ok',true,'status','refunded','transaction_id',v_tx.id);
end; $$;
revoke all on function public.reserve_mpesa_withdrawal(uuid,uuid,numeric,text,text,numeric,text) from public;
revoke all on function public.finalize_mpesa_withdrawal(text,text,integer,text,text,jsonb) from public;
grant execute on function public.reserve_mpesa_withdrawal(uuid,uuid,numeric,text,text,numeric,text) to service_role;
grant execute on function public.finalize_mpesa_withdrawal(text,text,integer,text,text,jsonb) to service_role;
alter table public.wallet_transactions drop constraint if exists wallet_transactions_mpesa_withdrawal_reference_check;
alter table public.wallet_transactions add constraint wallet_transactions_mpesa_withdrawal_reference_check check (payment_method <> 'mpesa' or type <> 'withdrawal' or provider_reference is not null);
