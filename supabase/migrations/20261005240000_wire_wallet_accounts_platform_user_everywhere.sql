-- Canonical wallet-account wiring across Testagram.
-- USER accounts are the user's spendable balance; PLATFORM is the Testagram
-- system account. Existing wallets remain the compatibility projection.

create schema if not exists private;

alter table public.wallet_accounts drop constraint if exists wallet_accounts_account_type_check;
alter table public.wallet_accounts add constraint wallet_accounts_account_type_check
  check (account_type in ('PLATFORM','USER','SAVINGS','DRIVER_PAYABLE','MPESA_CLEARING','MPESA_COST_RESERVE'));
alter table public.wallet_accounts drop constraint if exists wallet_accounts_currency_check;
alter table public.wallet_accounts add constraint wallet_accounts_currency_check
  check (currency in ('KES','USD','EUR'));

drop index if exists public.wallet_accounts_one_platform;
drop index if exists public.wallet_accounts_one_user;
drop index if exists public.wallet_accounts_one_driver_payable;
create unique index if not exists wallet_accounts_one_platform_currency on public.wallet_accounts(account_type,currency) where account_type='PLATFORM';
create unique index if not exists wallet_accounts_one_user_currency on public.wallet_accounts(user_id,currency) where account_type='USER' and user_id is not null;
create unique index if not exists wallet_accounts_one_driver_payable_currency on public.wallet_accounts(user_id,currency) where account_type='DRIVER_PAYABLE' and user_id is not null;
create unique index if not exists wallet_accounts_one_user_savings on public.wallet_accounts(user_id) where account_type='SAVINGS' and user_id is not null;

insert into public.wallet_accounts(account_type,currency,status)
values ('PLATFORM','KES','ACTIVE'),('MPESA_CLEARING','KES','ACTIVE'),('MPESA_COST_RESERVE','KES','ACTIVE')
on conflict do nothing;
insert into public.wallet_accounts(account_type,user_id,currency,status)
select 'USER',u.id,upper(coalesce(w.currency,'KES')),'ACTIVE' from auth.users u left join public.wallets w on w.user_id=u.id::text
on conflict do nothing;
insert into public.wallet_accounts(account_type,user_id,currency,status)
select 'DRIVER_PAYABLE',u.id,upper(coalesce(w.currency,'KES')),'ACTIVE' from auth.users u left join public.wallets w on w.user_id=u.id::text
on conflict do nothing;
insert into public.wallet_accounts(account_type,user_id,currency,status)
select 'SAVINGS',u.id,'KES','ACTIVE' from auth.users u
on conflict do nothing;

create or replace function private.ensure_user_financial_accounts(p_user_id uuid,p_currency text default 'KES')
returns void language plpgsql security definer set search_path=''
as $$
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  insert into public.wallet_accounts(account_type,user_id,currency,status)
    values ('USER',p_user_id,upper(p_currency),'ACTIVE') on conflict do nothing;
  insert into public.wallet_accounts(account_type,user_id,currency,status)
    values ('DRIVER_PAYABLE',p_user_id,upper(p_currency),'ACTIVE') on conflict do nothing;
  insert into public.wallet_accounts(account_type,user_id,currency,status)
    values ('SAVINGS',p_user_id,'KES','ACTIVE') on conflict do nothing;
end;
$$;

revoke all on function private.ensure_user_financial_accounts(uuid,text) from public,anon,authenticated;
grant execute on function private.ensure_user_financial_accounts(uuid,text) to service_role;

-- The only primitive that writes the canonical double-entry ledger.
create or replace function private.post_wallet_ledger(
  p_transaction_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_idempotency_key text,
  p_description text,
  p_entries jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_tx uuid;
  v_debits bigint;
  v_credits bigint;
  v_currency text;
  v_entry jsonb;
  v_account public.wallet_accounts%rowtype;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key))<8 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  select id into v_tx from public.ledger_transactions where idempotency_key=p_idempotency_key;
  if v_tx is not null then return v_tx; end if;
  if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<2 then
    raise exception 'LEDGER_ENTRIES_REQUIRED';
  end if;
  select coalesce(sum((e->>'amount_minor')::bigint) filter (where e->>'direction'='DEBIT'),0),
         coalesce(sum((e->>'amount_minor')::bigint) filter (where e->>'direction'='CREDIT'),0)
    into v_debits,v_credits
  from jsonb_array_elements(p_entries) e;
  if v_debits<=0 or v_debits<>v_credits then raise exception 'LEDGER_NOT_BALANCED'; end if;
  select currency into v_currency from public.wallet_accounts where id=(p_entries->0->>'account_id')::uuid;
  if v_currency is null then raise exception 'LEDGER_ACCOUNT_NOT_FOUND'; end if;

  insert into public.ledger_transactions(transaction_type,reference_type,reference_id,idempotency_key,status,currency,description,metadata)
  values(p_transaction_type,p_reference_type,p_reference_id,p_idempotency_key,'POSTED',v_currency,p_description,coalesce(p_metadata,'{}'::jsonb))
  returning id into v_tx;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    select * into v_account from public.wallet_accounts where id=(v_entry->>'account_id')::uuid for update;
    if not found then raise exception 'LEDGER_ACCOUNT_NOT_FOUND'; end if;
    if v_account.status<>'ACTIVE' then raise exception 'LEDGER_ACCOUNT_INACTIVE'; end if;
    if v_account.currency<>v_currency then raise exception 'LEDGER_CURRENCY_MISMATCH'; end if;
    if v_entry->>'direction' not in ('DEBIT','CREDIT') or (v_entry->>'amount_minor')::bigint<=0 then raise exception 'INVALID_LEDGER_ENTRY'; end if;
    insert into public.ledger_entries(transaction_id,account_id,direction,amount_minor,currency,metadata)
    values(v_tx,v_account.id,v_entry->>'direction',(v_entry->>'amount_minor')::bigint,v_currency,coalesce(v_entry->'metadata','{}'::jsonb));
  end loop;
  return v_tx;
end;
$$;
revoke all on function private.post_wallet_ledger(text,text,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.post_wallet_ledger(text,text,uuid,text,text,jsonb,jsonb) to service_role;

-- Mirror every new legacy wallet transaction into the canonical accounts. This
-- lets older features become ledger-backed without trusting browser balance math.
create or replace function private.mirror_wallet_transaction_to_ledger()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  uid uuid:=nullif(new.user_id,'')::uuid;
  recipient uuid:=nullif(new.counterparty_user_id,'')::uuid;
  user_account uuid;
  counter_account uuid;
  platform_account uuid;
  clearing_account uuid;
  amount_minor bigint:=round(abs(new.amount)*100)::bigint;
  key text:=coalesce(new.idempotency_key,'wallet-tx:'||new.id::text);
  txid uuid;
begin
  if new.status<>'completed' or uid is null or amount_minor<=0 then return new; end if;
  if coalesce(new.metadata->>'ledger_posted','false')='true' then return new; end if;
  perform private.ensure_user_financial_accounts(uid,upper(coalesce(new.currency,'KES')));
  select id into user_account from public.wallet_accounts where account_type='USER' and user_id=uid;
  select id into platform_account from public.wallet_accounts where account_type='PLATFORM' and currency=upper(coalesce(new.currency,'KES')) limit 1;
  if platform_account is null then insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM',upper(coalesce(new.currency,'KES')),'ACTIVE') returning id into platform_account; end if;
  select id into clearing_account from public.wallet_accounts where account_type='MPESA_CLEARING' and currency=upper(coalesce(new.currency,'KES')) limit 1;
  if clearing_account is null then insert into public.wallet_accounts(account_type,currency,status) values('MPESA_CLEARING',upper(coalesce(new.currency,'KES')),'ACTIVE') returning id into clearing_account; end if;

  if new.kind='p2p_transfer' and recipient is not null then
    perform private.ensure_user_financial_accounts(recipient,upper(coalesce(new.currency,'KES')));
    select id into counter_account from public.wallet_accounts where account_type='USER' and user_id=recipient;
    txid:=private.post_wallet_ledger('P2P_TRANSFER','wallet_transaction',new.id,'p2p:'||coalesce(new.transfer_id::text,new.reference,new.id::text),'Wallet transfer',
      jsonb_build_array(
        jsonb_build_object('account_id',user_account,'direction','DEBIT','amount_minor',amount_minor),
        jsonb_build_object('account_id',counter_account,'direction','CREDIT','amount_minor',amount_minor)
      ),jsonb_build_object('wallet_transaction_id',new.id));
    return new;
  end if;

  if new.direction in ('out','debit') then
    txid:=private.post_wallet_ledger(coalesce(new.kind,'WALLET_DEBIT'),'wallet_transaction',new.id,'wallet:'||new.id::text,'Wallet debit',
      jsonb_build_array(
        jsonb_build_object('account_id',user_account,'direction','DEBIT','amount_minor',amount_minor),
        jsonb_build_object('account_id',platform_account,'direction','CREDIT','amount_minor',amount_minor)
      ),jsonb_build_object('wallet_transaction_id',new.id,'kind',new.kind));
  else
    if lower(coalesce(new.provider,'')) in ('mpesa','mpesa_c2b','mpesa_stk','pesapal','paypal') then
      txid:=private.post_wallet_ledger(coalesce(new.kind,'WALLET_CREDIT'),'wallet_transaction',new.id,'wallet:'||new.id::text,'External wallet funding',
        jsonb_build_array(
          jsonb_build_object('account_id',clearing_account,'direction','DEBIT','amount_minor',amount_minor),
          jsonb_build_object('account_id',user_account,'direction','CREDIT','amount_minor',amount_minor)
        ),jsonb_build_object('wallet_transaction_id',new.id,'provider',new.provider));
    else
      txid:=private.post_wallet_ledger(coalesce(new.kind,'WALLET_CREDIT'),'wallet_transaction',new.id,'wallet:'||new.id::text,'Platform wallet credit',
        jsonb_build_array(
          jsonb_build_object('account_id',platform_account,'direction','DEBIT','amount_minor',amount_minor),
          jsonb_build_object('account_id',user_account,'direction','CREDIT','amount_minor',amount_minor)
        ),jsonb_build_object('wallet_transaction_id',new.id,'provider',new.provider));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists wallet_transactions_ledger_bridge on public.wallet_transactions;
create trigger wallet_transactions_ledger_bridge
after insert on public.wallet_transactions
for each row execute function private.mirror_wallet_transaction_to_ledger();

-- Canonical user debit used by boosts, paid content, campaign funding and other
-- platform purchases. The caller may only debit their own wallet.
create or replace function public.deduct_from_wallet(p_user_id uuid,p_amount numeric,p_description text default null)
returns boolean language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); w public.wallets%rowtype; before_balance numeric; amount numeric:=round(p_amount,2); txid uuid;
begin
  if u is null or p_user_id<>u then raise exception 'FORBIDDEN'; end if;
  if amount is null or amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
  select * into w from public.wallets where user_id=u::text for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if upper(coalesce(w.currency,'KES'))<>'KES' then raise exception 'WALLET_CURRENCY_NOT_SUPPORTED'; end if;
  if coalesce(w.status,'active')<>'active' or coalesce(w.spending_enabled,true)=false then raise exception 'WALLET_SPENDING_DISABLED'; end if;
  before_balance:=coalesce(w.balance,0);
  if before_balance<amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update public.wallets set balance=balance-amount,updated_at=now() where id=w.id;
  insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at)
  values(w.id,u::text,'platform_purchase','platform_purchase',amount,round(amount*100)::bigint,'KES','out','completed',before_balance,before_balance-amount,'testagram_platform',coalesce(p_description,'Testagram purchase'),'wallet','purchase:'||gen_random_uuid()::text,'debit:'||gen_random_uuid()::text,now(),now(),now())
  returning id into txid;
  return true;
end;
$$;
revoke all on function public.deduct_from_wallet(uuid,numeric,text) from public,anon;
grant execute on function public.deduct_from_wallet(uuid,numeric,text) to authenticated;

-- Atomic user -> platform -> creator settlement for paid creator content/subscriptions.
create or replace function public.wallet_pay_creator(p_to_user_id uuid,p_amount numeric,p_creator_share_bps integer,p_reference_type text,p_reference_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); w public.wallets%rowtype; r public.wallets%rowtype; before numeric; amount numeric:=round(p_amount,2); share numeric; fee numeric; txid uuid; creator_txid uuid;
  ua uuid; ra uuid; pa uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_to_user_id is null or p_to_user_id=u then raise exception 'INVALID_RECIPIENT'; end if;
  if amount<=0 or p_creator_share_bps not between 1 and 10000 then raise exception 'INVALID_PAYMENT'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key))<8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if upper(coalesce((select currency from public.wallets where user_id=u::text),'KES'))<>'KES' then raise exception 'WALLET_CURRENCY_NOT_SUPPORTED'; end if;
  perform pg_advisory_xact_lock(hashtext('creator-pay:'||u::text||':'||p_idempotency_key));
  select id into txid from public.ledger_transactions where idempotency_key='creator-pay:'||p_idempotency_key;
  if txid is not null then return jsonb_build_object('ok',true,'idempotent',true,'ledger_transaction_id',txid); end if;
  select * into w from public.wallets where user_id=u::text for update;
  if not found or coalesce(w.status,'active')<>'active' or not coalesce(w.spending_enabled,true) then raise exception 'WALLET_SPENDING_DISABLED'; end if;
  select * into r from public.wallets where user_id=p_to_user_id::text for update;
  if not found then insert into public.wallets(user_id,balance,currency,status) values(p_to_user_id::text,0,'KES','active') returning * into r; end if;
  before:=coalesce(w.balance,0); if before<amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
  share:=round(amount*p_creator_share_bps/10000.0,2); fee:=round(amount-share,2);
  update public.wallets set balance=balance-amount,updated_at=now() where id=w.id;
  update public.wallets set balance=balance+share,updated_at=now() where id=r.id;
  perform private.ensure_user_financial_accounts(u,'KES'); perform private.ensure_user_financial_accounts(p_to_user_id,'KES');
  select id into ua from public.wallet_accounts where account_type='USER' and user_id=u;
  select id into ra from public.wallet_accounts where account_type='USER' and user_id=p_to_user_id;
  select id into pa from public.wallet_accounts where account_type='PLATFORM' limit 1;
  txid:=private.post_wallet_ledger('CREATOR_PAYMENT','payout',p_reference_id,'creator-pay:'||p_idempotency_key,'Creator payment',jsonb_build_array(
    jsonb_build_object('account_id',ua,'direction','DEBIT','amount_minor',round(amount*100)::bigint),jsonb_build_object('account_id',pa,'direction','CREDIT','amount_minor',round(amount*100)::bigint)
  ),jsonb_build_object('creator_user_id',p_to_user_id,'share_bps',p_creator_share_bps));
  creator_txid:=private.post_wallet_ledger('CREATOR_EARNING','payout',p_reference_id,'creator-credit:'||p_idempotency_key,'Creator earning',jsonb_build_array(
    jsonb_build_object('account_id',pa,'direction','DEBIT','amount_minor',round(share*100)::bigint),jsonb_build_object('account_id',ra,'direction','CREDIT','amount_minor',round(share*100)::bigint)
  ),jsonb_build_object('creator_user_id',p_to_user_id,'share',share,'platform_fee',fee));
  insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at,metadata)
  values(w.id,u::text,'creator_payment','creator_payment',amount,round(amount*100)::bigint,'KES','out','completed',before,before-amount,'testagram_platform','Creator purchase','wallet',p_reference_type||':'||p_reference_id,p_idempotency_key,now(),now(),now(),jsonb_build_object('creator_user_id',p_to_user_id,'creator_share',share,'platform_fee',fee,'ledger_posted',true));
  return jsonb_build_object('ok',true,'amount',amount,'creator_share',share,'platform_fee',fee,'ledger_transaction_id',txid,'creator_ledger_transaction_id',creator_txid);
end;
$$;
revoke all on function public.wallet_pay_creator(uuid,numeric,integer,text,uuid,text) from public,anon;
grant execute on function public.wallet_pay_creator(uuid,numeric,integer,text,uuid,text) to authenticated;

-- Opening-balance bridge: only creates accounting history for existing positive
-- wallet balances; it never changes the user's displayed balance.
do $$
declare r record; ua uuid; pa uuid; key text; amt bigint;
begin
  select id into pa from public.wallet_accounts where account_type='PLATFORM' limit 1;
  for r in select id,user_id,balance from public.wallets where coalesce(balance,0)>0 and upper(coalesce(currency,'KES'))='KES' loop
    perform private.ensure_user_financial_accounts(r.user_id::uuid);
    select id into ua from public.wallet_accounts where account_type='USER' and user_id=r.user_id::uuid;
    key:='opening-wallet:'||r.id::text; amt:=round(r.balance*100)::bigint;
    if not exists(select 1 from public.ledger_transactions where idempotency_key=key) then
      perform private.post_wallet_ledger('OPENING_BALANCE','wallet',r.id,key,'Legacy wallet opening balance',jsonb_build_array(
        jsonb_build_object('account_id',pa,'direction','DEBIT','amount_minor',amt),jsonb_build_object('account_id',ua,'direction','CREDIT','amount_minor',amt)
      ),jsonb_build_object('legacy_wallet_id',r.id));
    end if;
  end loop;
end $$;
