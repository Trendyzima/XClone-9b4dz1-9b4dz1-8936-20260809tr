-- Canonical Wallet -> User/Platform settlement for monetized Testagram features.
-- KES is the canonical internal settlement currency. Legacy public.wallets is kept as the UI projection.
begin;
create schema if not exists private;

create or replace function private.wallet_normalize_kes_wallet(p_user_id uuid)
returns public.wallets language plpgsql security definer set search_path='' as $$
declare w public.wallets%rowtype;
begin
 select * into w from public.wallets where user_id=p_user_id::text for update;
 if not found then
  insert into public.wallets(user_id,balance,currency,status,spending_enabled,withdrawals_enabled)
  values(p_user_id::text,0,'KES','active',true,true) on conflict(user_id) do nothing;
  select * into w from public.wallets where user_id=p_user_id::text for update;
 end if;
 if upper(coalesce(w.currency,'KES'))<>'KES' then
  if coalesce(w.balance,0)<>0 then raise exception 'WALLET_CURRENCY_MUST_BE_KES'; end if;
  update public.wallets set currency='KES',preferred_currency='KES',updated_at=now() where id=w.id returning * into w;
 end if;
 if coalesce(w.status,'active')<>'active' or coalesce(w.spending_enabled,true)=false then raise exception 'WALLET_SPENDING_DISABLED'; end if;
 return w;
end $$;

create or replace function private.wallet_charge_platform_kes(p_amount numeric,p_feature text,p_reference_id uuid,p_idempotency_key text,p_description text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); amt numeric:=round(p_amount,2); w public.wallets%rowtype; ua public.wallet_accounts%rowtype; pa public.wallet_accounts%rowtype; balance_kes numeric; ledger_id uuid; txid uuid;
begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if amt is null or amt<=0 then raise exception 'INVALID_AMOUNT'; end if;
 if p_idempotency_key is null or length(trim(p_idempotency_key))<8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 select * into w from private.wallet_normalize_kes_wallet(uid);
 perform public.ensure_user_financial_accounts(uid);
 select * into ua from public.wallet_accounts where account_type='USER' and user_id=uid and currency='KES' for update;
 insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM','KES','ACTIVE') on conflict do nothing;
 select * into pa from public.wallet_accounts where account_type='PLATFORM' and currency='KES' for update;
 select coalesce(sum(case when le.direction='CREDIT' then le.amount_minor else -le.amount_minor end),0)/100.0 into balance_kes from public.ledger_entries le where le.account_id=ua.id;
 if balance_kes<amt then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
 if coalesce(w.daily_spend_limit,0)>0 and w.spend_limit_enabled and coalesce((select sum(abs(amount)) from public.wallet_transactions where user_id=uid::text and direction in ('debit','out') and status='completed' and created_at>=date_trunc('day',now())),0)+amt>w.daily_spend_limit then raise exception 'DAILY_WALLET_SPENDING_LIMIT_EXCEEDED'; end if;
 ledger_id:=public.post_balanced_ledger_transaction(upper(p_feature)||'_CHARGE','wallet',p_reference_id,p_idempotency_key,p_description,
  jsonb_build_array(jsonb_build_object('account_id',ua.id,'direction','DEBIT','amount_minor',round(amt*100)::bigint,'metadata',coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('component','user_wallet')),
                    jsonb_build_object('account_id',pa.id,'direction','CREDIT','amount_minor',round(amt*100)::bigint,'metadata',coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('component','platform_account'))),
  coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('feature',p_feature));
 update public.wallets set balance=greatest(0,balance-amt),updated_at=now() where id=w.id;
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at,metadata)
 values(w.id,uid::text,p_feature||'_charge',p_feature||'_charge',amt,round(amt*100)::bigint,'KES','debit','completed',w.balance,w.balance-amt,'testagram_wallet',p_description,'wallet',p_feature||':'||coalesce(p_reference_id::text,gen_random_uuid()::text),p_idempotency_key,now(),now(),now(),coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('ledger_transaction_id',ledger_id,'feature',p_feature)) returning id into txid;
 return jsonb_build_object('ok',true,'amount',amt,'currency','KES','wallet_transaction_id',txid,'ledger_transaction_id',ledger_id);
end $$;

create or replace function private.wallet_credit_user_from_platform_kes(p_user_id uuid,p_amount numeric,p_feature text,p_reference_id uuid,p_idempotency_key text,p_description text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=p_user_id; amt numeric:=round(p_amount,2); w public.wallets%rowtype; ua public.wallet_accounts%rowtype; pa public.wallet_accounts%rowtype; platform_balance numeric; before_balance numeric; ledger_id uuid; txid uuid;
begin
 if uid is null then raise exception 'USER_REQUIRED'; end if; if amt is null or amt<=0 then raise exception 'INVALID_AMOUNT'; end if;
 if p_idempotency_key is null or length(trim(p_idempotency_key))<8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 select * into w from private.wallet_normalize_kes_wallet(uid); perform public.ensure_user_financial_accounts(uid);
 select * into ua from public.wallet_accounts where account_type='USER' and user_id=uid and currency='KES' for update;
 insert into public.wallet_accounts(account_type,currency,status) values('PLATFORM','KES','ACTIVE') on conflict do nothing;
 select * into pa from public.wallet_accounts where account_type='PLATFORM' and currency='KES' for update;
 select coalesce(sum(case when le.direction='CREDIT' then le.amount_minor else -le.amount_minor end),0)/100.0 into platform_balance from public.ledger_entries le where le.account_id=pa.id;
 if platform_balance<amt then raise exception 'PLATFORM_WALLET_INSUFFICIENT_FUNDS'; end if;
 before_balance:=coalesce(w.balance,0);
 ledger_id:=public.post_balanced_ledger_transaction(upper(p_feature)||'_PAYOUT','wallet',p_reference_id,p_idempotency_key,p_description,
  jsonb_build_array(jsonb_build_object('account_id',pa.id,'direction','DEBIT','amount_minor',round(amt*100)::bigint,'metadata',coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('component','platform_account')),
                    jsonb_build_object('account_id',ua.id,'direction','CREDIT','amount_minor',round(amt*100)::bigint,'metadata',coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('component','user_wallet','user_id',uid))),
  coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('feature',p_feature));
 update public.wallets set balance=balance+amt,updated_at=now() where id=w.id;
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at,metadata)
 values(w.id,uid::text,p_feature||'_payout',p_feature||'_payout',amt,round(amt*100)::bigint,'KES','credit','completed',before_balance,before_balance+amt,'testagram_platform',p_description,'wallet',p_feature||':'||coalesce(p_reference_id::text,gen_random_uuid()::text),p_idempotency_key,now(),now(),now(),coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('ledger_transaction_id',ledger_id,'feature',p_feature)) returning id into txid;
 return jsonb_build_object('ok',true,'amount',amt,'currency','KES','wallet_transaction_id',txid,'ledger_transaction_id',ledger_id);
end $$;
revoke all on function private.wallet_normalize_kes_wallet(uuid) from public,anon,authenticated;
revoke all on function private.wallet_charge_platform_kes(numeric,text,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function private.wallet_credit_user_from_platform_kes(uuid,numeric,text,uuid,text,text,jsonb) from public,anon,authenticated;

alter table public.boosts add column if not exists spent_minor bigint not null default 0;
alter table public.boosts add column if not exists impressions bigint not null default 0;
alter table public.boosts add column if not exists clicks bigint not null default 0;
alter table public.boosts add column if not exists target_audience jsonb not null default '{}'::jsonb;
alter table public.boosts add column if not exists auto_renew boolean not null default false;
alter table public.boosts add column if not exists auto_renew_days integer not null default 7;
alter table public.boosts add column if not exists created_by uuid references auth.users(id);

create or replace function public.create_boost_campaign(p_post_id uuid,p_boost_type text,p_budget_minor bigint,p_starts_at timestamptz,p_ends_at timestamptz,p_target_audience jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); bid uuid:=gen_random_uuid(); amt numeric;
begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_post_id is null or not exists(select 1 from public.posts where id=p_post_id and coalesce(author_id,user_id)=uid and deleted_at is null) then raise exception 'POST_NOT_OWNED'; end if;
 if p_boost_type not in ('reach','engagement','conversions','video_views') then raise exception 'INVALID_BOOST_TYPE'; end if;
 if p_budget_minor is null or p_budget_minor<100 then raise exception 'INVALID_BUDGET'; end if;
 if p_ends_at<=coalesce(p_starts_at,now()) then raise exception 'INVALID_DATES'; end if;
 amt:=round(p_budget_minor/100.0,2);
 perform private.wallet_charge_platform_kes(amt,'boost',bid,'boost:'||bid::text,'Boost campaign funding',jsonb_build_object('post_id',p_post_id,'boost_type',p_boost_type,'budget_minor',p_budget_minor));
 insert into public.boosts(id,user_id,created_by,post_id,budget_minor,currency,status,starts_at,ends_at,target_audience)
 values(bid,uid,uid,p_post_id,p_budget_minor,'KES','active',coalesce(p_starts_at,now()),p_ends_at,coalesce(p_target_audience,'{}'::jsonb));
 return bid;
end $$;
revoke all on function public.create_boost_campaign(uuid,text,bigint,timestamptz,timestamptz,jsonb) from public,anon;
grant execute on function public.create_boost_campaign(uuid,text,bigint,timestamptz,timestamptz,jsonb) to authenticated;

create or replace function public.add_boost_budget(p_boost_id uuid,p_amount_minor bigint)
returns public.boosts language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); b public.boosts%rowtype; amt numeric;
begin
 if uid is null then raise exception 'AUTH_REQUIRED'; end if; if p_amount_minor is null or p_amount_minor<100 then raise exception 'INVALID_AMOUNT'; end if;
 select * into b from public.boosts where id=p_boost_id and user_id=uid for update; if not found then raise exception 'BOOST_NOT_FOUND'; end if;
 amt:=round(p_amount_minor/100.0,2);
 perform private.wallet_charge_platform_kes(amt,'boost_topup',b.id,'boost-topup:'||b.id::text||':'||p_amount_minor::text||':'||extract(epoch from clock_timestamp())::bigint,'Boost campaign budget top-up',jsonb_build_object('boost_id',b.id));
 update public.boosts set budget_minor=budget_minor+p_amount_minor,status=case when status='paused' then 'active' else status end where id=b.id returning * into b;
 return b;
end $$;
revoke all on function public.add_boost_budget(uuid,bigint) from public,anon;
grant execute on function public.add_boost_budget(uuid,bigint) to authenticated;

create or replace function public.get_my_wallet()
returns jsonb language plpgsql security definer set search_path='public' as $$
declare w public.wallets; u uuid:=auth.uid();
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into w from public.wallets where user_id=u::text limit 1;
 if not found then
  insert into public.wallets(user_id,balance,currency,status,spending_enabled,withdrawals_enabled,preferred_currency)
  values(u::text,0,'KES','active',true,true,'KES') returning * into w;
 elsif upper(coalesce(w.currency,'KES'))<>'KES' and coalesce(w.balance,0)=0 then
  update public.wallets set currency='KES',preferred_currency='KES',updated_at=now() where id=w.id returning * into w;
 end if;
 return jsonb_build_object('id',w.id,'user_id',w.user_id,'balance',w.balance,'currency',w.currency,'created_at',w.created_at,'updated_at',w.updated_at,'total_deposited',w.total_deposited,'total_withdrawn',w.total_withdrawn,'mpesa_phone',w.mpesa_phone,'paypal_email',w.paypal_email,'status',w.status,'spending_enabled',w.spending_enabled,'withdrawals_enabled',w.withdrawals_enabled,'spend_limit_enabled',w.spend_limit_enabled,'daily_spend_limit',w.daily_spend_limit,'preferred_currency',w.preferred_currency,'savings_balance',w.savings_balance);
end $$;

commit;