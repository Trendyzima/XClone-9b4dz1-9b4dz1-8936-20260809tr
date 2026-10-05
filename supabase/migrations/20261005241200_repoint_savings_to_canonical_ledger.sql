create or replace function public.get_user_wallet_summary()
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'ok',true,
    'account_id',u.id,
    'balance_kes',coalesce(u.balance_kes,0),
    'savings_account_id',s.id,
    'savings_kes',coalesce(s.balance_kes,0),
    'savings_limit_kes',20000,
    'savings_remaining_kes',greatest(0,20000-coalesce(s.balance_kes,0)),
    'currency','KES',
    'status',coalesce(u.status,'ACTIVE')
  )
  from public.wallet_account_balances u
  left join public.wallet_account_balances s on s.account_type='SAVINGS' and s.user_id=auth.uid()
  where u.account_type='USER' and u.user_id=auth.uid() and u.currency='KES'
  limit 1
$$;
revoke all on function public.get_user_wallet_summary() from public,anon;
grant execute on function public.get_user_wallet_summary() to authenticated;

create or replace function public.save_to_wallet_savings(p_amount numeric,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare uid uuid:=auth.uid(); wallet_id uuid; savings_id uuid; wallet_bal numeric; savings_bal numeric; amount numeric:=round(p_amount,2); ledger_id uuid; w public.wallets%rowtype;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if amount is null or amount<=0 or amount>20000 then raise exception 'Invalid savings amount'; end if;
 if p_idempotency_key is null or length(p_idempotency_key)<8 or p_idempotency_key !~ '^[A-Za-z0-9:_-]+$' then raise exception 'Valid idempotency key required'; end if;
 select * into w from public.wallets where user_id=uid::text for update;
 if not found or upper(coalesce(w.currency,'KES'))<>'KES' then raise exception 'KES wallet required'; end if;
 perform private.ensure_user_financial_accounts(uid,'KES');
 select id into wallet_id from public.wallet_accounts where account_type='USER' and user_id=uid and currency='KES' for update;
 select id into savings_id from public.wallet_accounts where account_type='SAVINGS' and user_id=uid and currency='KES' for update;
 select coalesce(balance_kes,0) into wallet_bal from public.wallet_account_balances where id=wallet_id;
 select coalesce(balance_kes,0) into savings_bal from public.wallet_account_balances where id=savings_id;
 if savings_bal+amount>20000 then raise exception 'Savings limit is KES 20,000'; end if;
 if wallet_bal<amount then raise exception 'Insufficient wallet balance'; end if;
 ledger_id:=private.post_wallet_ledger('SAVINGS_DEPOSIT','wallet',wallet_id,p_idempotency_key,'Move wallet funds into savings',jsonb_build_array(
   jsonb_build_object('account_id',wallet_id,'direction','DEBIT','amount_minor',round(amount*100)::bigint),
   jsonb_build_object('account_id',savings_id,'direction','CREDIT','amount_minor',round(amount*100)::bigint)
 ),jsonb_build_object('component','wallet_to_savings','savings_limit_kes',20000));
 update public.wallets set balance=greatest(0,balance-amount),updated_at=now() where id=w.id;
 return jsonb_build_object('ok',true,'amount',amount,'currency','KES','savings_balance_kes',savings_bal+amount,'savings_remaining_kes',greatest(0,20000-savings_bal-amount),'ledger_transaction_id',ledger_id);
end;
$$;
revoke all on function public.save_to_wallet_savings(numeric,text) from public,anon;
grant execute on function public.save_to_wallet_savings(numeric,text) to authenticated;

create or replace function public.withdraw_from_wallet_savings(p_amount numeric,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare uid uuid:=auth.uid(); wallet_id uuid; savings_id uuid; savings_bal numeric; amount numeric:=round(p_amount,2); ledger_id uuid; w public.wallets%rowtype;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if amount is null or amount<=0 then raise exception 'Invalid savings withdrawal amount'; end if;
 if p_idempotency_key is null or length(p_idempotency_key)<8 or p_idempotency_key !~ '^[A-Za-z0-9:_-]+$' then raise exception 'Valid idempotency key required'; end if;
 select * into w from public.wallets where user_id=uid::text for update;
 if not found or upper(coalesce(w.currency,'KES'))<>'KES' then raise exception 'KES wallet required'; end if;
 perform private.ensure_user_financial_accounts(uid,'KES');
 select id into wallet_id from public.wallet_accounts where account_type='USER' and user_id=uid and currency='KES' for update;
 select id into savings_id from public.wallet_accounts where account_type='SAVINGS' and user_id=uid and currency='KES' for update;
 select coalesce(balance_kes,0) into savings_bal from public.wallet_account_balances where id=savings_id;
 if savings_bal<amount then raise exception 'Insufficient savings balance'; end if;
 ledger_id:=private.post_wallet_ledger('SAVINGS_WITHDRAWAL','wallet',savings_id,p_idempotency_key,'Move savings back to wallet',jsonb_build_array(
   jsonb_build_object('account_id',savings_id,'direction','DEBIT','amount_minor',round(amount*100)::bigint),
   jsonb_build_object('account_id',wallet_id,'direction','CREDIT','amount_minor',round(amount*100)::bigint)
 ),jsonb_build_object('component','savings_to_wallet'));
 update public.wallets set balance=balance+amount,updated_at=now() where id=w.id;
 return jsonb_build_object('ok',true,'amount',amount,'currency','KES','savings_balance_kes',savings_bal-amount,'ledger_transaction_id',ledger_id);
end;
$$;
revoke all on function public.withdraw_from_wallet_savings(numeric,text) from public,anon;
grant execute on function public.withdraw_from_wallet_savings(numeric,text) to authenticated;
