create index if not exists paypal_webhook_events_order_idx on public.paypal_webhook_events(paypal_order_id);
create index if not exists paypal_webhook_events_received_idx on public.paypal_webhook_events(received_at desc);
alter table public.paypal_webhook_events enable row level security;
revoke all on public.paypal_webhook_events from public, anon, authenticated;
grant select, insert, update on public.paypal_webhook_events to service_role;

create or replace function public.finalize_paypal_topup(p_order_id text, p_capture_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_order public.paypal_orders; v_tx public.wallet_transactions; v_wallet public.wallets; v_before numeric; v_after numeric; v_amount_cents bigint; v_currency text; v_user uuid; v_existing_capture text;
begin
 if p_order_id is null or nullif(btrim(p_order_id),'') is null then raise exception 'order_id_required' using errcode='22023'; end if;
 if p_capture_id is null or nullif(btrim(p_capture_id),'') is null then raise exception 'capture_id_required' using errcode='22023'; end if;
 select * into v_order from public.paypal_orders where coalesce(order_id,paypal_order_id)=p_order_id for update;
 if not found then raise exception 'paypal_order_not_found' using errcode='P0002'; end if;
 v_existing_capture:=coalesce(v_order.capture_id,v_order.paypal_capture_id);
 if v_existing_capture is not null then
   if v_existing_capture<>p_capture_id then raise exception 'capture_id_conflict' using errcode='23514'; end if;
   return jsonb_build_object('ok',true,'idempotent',true,'order_id',p_order_id,'capture_id',p_capture_id);
 end if;
 if v_order.wallet_transaction_id is null then raise exception 'paypal_order_missing_transaction'; end if;
 select * into v_tx from public.wallet_transactions where id=v_order.wallet_transaction_id for update;
 if not found then raise exception 'wallet_transaction_not_found' using errcode='P0002'; end if;
 if upper(coalesce(v_tx.provider,''))<>'PAYPAL' then raise exception 'wallet_transaction_provider_mismatch' using errcode='23514'; end if;
 if upper(coalesce(v_tx.currency,''))<>upper(v_order.currency) then raise exception 'wallet_transaction_currency_mismatch' using errcode='23514'; end if;
 if round(coalesce(v_tx.amount,0),2)<>round(coalesce(v_order.amount,v_order.amount_cents::numeric/100),2) then raise exception 'wallet_transaction_amount_mismatch' using errcode='23514'; end if;
 if v_tx.status='completed' then
   update public.paypal_orders set capture_id=p_capture_id,paypal_capture_id=p_capture_id,status='captured',captured_at=coalesce(captured_at,now()),updated_at=now() where id=v_order.id;
   return jsonb_build_object('ok',true,'idempotent',true,'order_id',p_order_id,'capture_id',p_capture_id,'transaction_id',v_tx.id);
 end if;
 if v_tx.status<>'pending' then raise exception 'wallet_transaction_not_pending' using errcode='23514'; end if;
 select * into v_wallet from public.wallets where id=v_tx.wallet_id and user_id=v_tx.user_id for update;
 if not found then raise exception 'wallet_not_found' using errcode='P0002'; end if;
 v_before:=coalesce(v_wallet.balance,0); v_after:=v_before+v_tx.amount;
 update public.wallets set balance=v_after,total_deposited=coalesce(total_deposited,0)+v_tx.amount,updated_at=now() where id=v_wallet.id;
 update public.wallet_transactions set status='completed',balance_before=v_before,balance_after=v_after,provider_status='COMPLETED',provider_capture_id=p_capture_id,payment_method='paypal',completed_at=now() where id=v_tx.id;
 update public.paypal_orders set status='captured',capture_id=p_capture_id,paypal_capture_id=p_capture_id,captured_at=now(),updated_at=now() where id=v_order.id;
 v_amount_cents:=round(v_tx.amount*100); v_currency:=upper(coalesce(v_tx.currency,'USD')); v_user:=v_tx.user_id;
 insert into public.monetization_accounts(user_id,currency) values(v_user,v_currency) on conflict(user_id) do nothing;
 insert into public.monetization_ledger(account_user_id,entry_type,direction,amount_cents,currency,state,gross_cents,platform_fee_cents,creator_share_bps,provider,provider_event_id,provider_reference,idempotency_key,source_type,source_id,description,metadata,available_at,settled_at)
 values(v_user,'topup','credit',v_amount_cents,v_currency,'available',v_amount_cents,0,10000,'paypal',p_capture_id,p_order_id,'paypal-topup:'||p_capture_id,'paypal_order',p_order_id,'PayPal wallet top-up',jsonb_build_object('wallet_transaction_id',v_tx.id),now(),now())
 on conflict (account_user_id,idempotency_key) where idempotency_key is not null do nothing;
 return jsonb_build_object('ok',true,'idempotent',false,'order_id',p_order_id,'capture_id',p_capture_id,'transaction_id',v_tx.id,'wallet_id',v_wallet.id,'status','completed','amount',v_tx.amount,'currency',v_tx.currency,'balance_before',v_before,'balance_after',v_after);
end;
$$;
revoke all on function public.finalize_paypal_topup(text,text) from public, anon, authenticated;
grant execute on function public.finalize_paypal_topup(text,text) to service_role;
