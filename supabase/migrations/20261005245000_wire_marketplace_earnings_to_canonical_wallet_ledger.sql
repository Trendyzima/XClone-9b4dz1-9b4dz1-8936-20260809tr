-- Wire marketplace delivery earnings withdrawals into the canonical PLATFORM/USER ledger.
-- system_wallets remains a compatibility/earmark projection; PLATFORM is authoritative.

create or replace function public.withdraw_marketplace_earnings()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  uid uuid:=auth.uid();
  w public.wallets%rowtype;
  sw public.system_wallets%rowtype;
  e record;
  gross numeric:=0;
  fee numeric:=0;
  net numeric:=0;
  txid uuid;
  ledger_id uuid;
  before_balance numeric;
  currency_code text;
  user_account uuid;
  platform_account uuid;
  ledger_key text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into w from public.wallets where user_id=uid::text for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if coalesce(w.withdrawals_enabled,false)=false then raise exception 'WITHDRAWALS_DISABLED'; end if;
  currency_code:=upper(coalesce(w.currency,w.preferred_currency,'KES'));
  select * into sw from public.system_wallets where currency=currency_code for update;
  if not found then raise exception 'NO_SYSTEM_EARNINGS'; end if;

  for e in select * from public.marketplace_delivery_earnings
    where courier_id=uid and status='available' and currency=currency_code
    order by created_at for update loop
    gross:=gross+e.gross_amount;
    fee:=fee+e.platform_fee;
    net:=net+e.net_amount;
  end loop;

  if gross<=0 then raise exception 'NO_WITHDRAWABLE_EARNINGS'; end if;
  if sw.balance<gross then raise exception 'SYSTEM_WALLET_BALANCE_MISMATCH'; end if;

  perform private.ensure_user_financial_accounts(uid,currency_code);
  select id into user_account from public.wallet_accounts
    where account_type='USER' and user_id=uid and currency=currency_code for update;
  select id into platform_account from public.wallet_accounts
    where account_type='PLATFORM' and currency=currency_code for update;
  if user_account is null or platform_account is null then raise exception 'FINANCIAL_ACCOUNTS_NOT_READY'; end if;

  before_balance:=coalesce(w.balance,0);
  ledger_key:='marketplace-earnings-withdrawal:'||uid::text||':'||md5(
    coalesce(e.id::text,'')
  );

  ledger_id:=private.post_wallet_ledger(
    'MARKETPLACE_EARNINGS_WITHDRAWAL','marketplace_delivery_earnings',uid,ledger_key,
    'Marketplace delivery earnings withdrawal',
    jsonb_build_array(
      jsonb_build_object('account_id',platform_account,'direction','DEBIT','amount_minor',round(gross*100)::bigint),
      jsonb_build_object('account_id',user_account,'direction','CREDIT','amount_minor',round(net*100)::bigint)
    ),
    jsonb_build_object('gross_amount',gross,'platform_fee',fee,'platform_fee_rate',0.10,
      'net_amount',net,'currency',currency_code,'system_wallet_compatibility',true)
  );

  update public.system_wallets
  set balance=balance-gross,total_platform_fees=total_platform_fees+fee,
      total_released=total_released+net,updated_at=now()
  where currency=currency_code;
  update public.wallets set balance=balance+net,updated_at=now() where id=w.id;

  insert into public.wallet_transactions(
    wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,
    balance_before,balance_after,provider,provider_reference,provider_status,
    description,metadata,payment_method,reference,idempotency_key,completed_at,created_at,updated_at
  )
  values(
    w.id,uid::text,'delivery_earnings_withdrawal','delivery_earnings_withdrawal',
    net,round(net*100)::bigint,currency_code,'in','completed',
    before_balance,before_balance+net,'testagram_system_wallet',
    'EARNINGS-'||gen_random_uuid()::text,'completed',
    'Marketplace delivery earnings withdrawal',
    jsonb_build_object('gross',gross,'platform_fee',fee,'platform_fee_rate',0.10,
      'net',net,'ledger_posted',true,'ledger_transaction_id',ledger_id),
    'wallet','delivery-earnings-withdrawal',ledger_key,now(),now(),now()
  )
  returning id into txid;

  update public.marketplace_delivery_earnings
  set status='withdrawn',withdrawal_transaction_id=txid,withdrawn_at=now()
  where courier_id=uid and status='available' and currency=currency_code;

  insert into public.system_wallet_ledger(
    currency,entry_type,amount,courier_id,wallet_transaction_id,idempotency_key,metadata
  ) values(currency_code,'platform_fee',fee,uid,txid,'platform-fee:'||txid::text,
    jsonb_build_object('gross',gross,'fee_rate',0.10,'net',net,'ledger_transaction_id',ledger_id))
  on conflict(idempotency_key) do nothing;

  insert into public.system_wallet_ledger(
    currency,entry_type,amount,courier_id,wallet_transaction_id,idempotency_key,metadata
  ) values(currency_code,'courier_withdrawal',net,uid,txid,'courier-withdrawal:'||txid::text,
    jsonb_build_object('gross',gross,'platform_fee',fee,'net',net,'ledger_transaction_id',ledger_id))
  on conflict(idempotency_key) do nothing;

  return jsonb_build_object('ok',true,'gross_amount',gross,'platform_fee',fee,
    'platform_fee_rate',0.10,'net_amount',net,'currency',currency_code,
    'wallet_transaction_id',txid,'ledger_transaction_id',ledger_id);
end
$function$;

revoke execute on function public.withdraw_marketplace_earnings() from public,anon;
grant execute on function public.withdraw_marketplace_earnings() to authenticated;