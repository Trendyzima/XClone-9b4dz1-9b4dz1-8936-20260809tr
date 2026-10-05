-- Production hardening: wallet ride fraud controls + retry-safe ride creation.
-- Additive migration; safe to replay with IF NOT EXISTS guards where applicable.

alter table public.rides add column if not exists idempotency_key text;
create unique index if not exists rides_user_idempotency_key_uidx
  on public.rides(user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.wallet_risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  operation text not null,
  amount numeric not null check (amount > 0),
  currency text not null,
  reference_id uuid,
  idempotency_key text,
  decision text not null check (decision in ('allow','block','review')),
  risk_score integer not null check (risk_score between 0 and 100),
  reason_codes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_risk_events_user_created_idx
  on public.wallet_risk_events(user_id, created_at desc);
create index if not exists wallet_risk_events_reference_idx
  on public.wallet_risk_events(reference_id);

alter table public.wallet_risk_events enable row level security;
revoke all on table public.wallet_risk_events from anon, authenticated;
grant all on table public.wallet_risk_events to service_role;

drop policy if exists wallet_risk_events_authenticated_deny on public.wallet_risk_events;
create policy wallet_risk_events_authenticated_deny
  on public.wallet_risk_events as restrictive for all to authenticated
  using (false) with check (false);
drop policy if exists wallet_risk_events_anon_deny on public.wallet_risk_events;
create policy wallet_risk_events_anon_deny
  on public.wallet_risk_events as restrictive for all to anon
  using (false) with check (false);

create or replace function public.wallet_pay_ride(
  p_ride_id uuid,
  p_amount numeric,
  p_currency text default 'KES',
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_wallet public.wallets%rowtype;
  v_ride public.rides%rowtype;
  v_tx public.wallet_transactions%rowtype;
  v_txid uuid;
  v_key text;
  v_existing_ride uuid;
  v_risk integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_recent_15m integer := 0;
  v_recent_24h integer := 0;
  v_amount_24h numeric := 0;
  v_pin_set boolean := false;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_ride_id is null or p_amount is null or p_amount <= 0 then raise exception 'Invalid ride payment'; end if;
  if upper(coalesce(p_currency,'')) <> 'KES' then raise exception 'Ride wallet payments currently require KES'; end if;

  v_key := nullif(trim(coalesce(p_idempotency_key,'')),'');
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 or v_key !~ '^[A-Za-z0-9:_-]+$' then
    raise exception 'A valid idempotency key is required';
  end if;

  select * into v_ride from public.rides
    where id=p_ride_id and user_id=v_uid for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status <> 'completed' then raise exception 'Ride is not completed'; end if;
  if v_ride.fare is null or abs(v_ride.fare::numeric-p_amount)>0.01 then raise exception 'Ride fare mismatch'; end if;
  if exists (
    select 1 from public.wallet_transactions
    where user_id=v_uid::text and metadata->>'ride_id'=p_ride_id::text and status='completed'
  ) then raise exception 'Ride has already been paid'; end if;

  select * into v_wallet from public.wallets where user_id=v_uid::text for update;
  if not found then raise exception 'Wallet not found'; end if;
  if coalesce(v_wallet.status,'active')<>'active' or coalesce(v_wallet.spending_enabled,true)=false then
    raise exception 'Wallet spending is disabled';
  end if;
  select exists(select 1 from public.wallet_security where user_id=v_uid and pin_hash is not null) into v_pin_set;

  select * into v_tx from public.wallet_transactions
    where user_id=v_uid::text and idempotency_key=v_key limit 1;
  if found then
    v_existing_ride := nullif(v_tx.metadata->>'ride_id','')::uuid;
    if coalesce(v_tx.amount,0)<>p_amount
       or upper(coalesce(v_tx.currency,''))<>upper(p_currency)
       or v_existing_ride is distinct from p_ride_id then
      raise exception 'Idempotency key conflict';
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,'transaction_id',v_tx.id,
      'status',v_tx.status,'amount',v_tx.amount,'currency',v_tx.currency);
  end if;

  select count(*) into v_recent_15m from public.wallet_transactions
    where user_id=v_uid::text and kind='ride_payment' and direction='debit'
      and status='completed' and created_at>=now()-interval '15 minutes';
  select count(*) into v_recent_24h from public.wallet_transactions
    where user_id=v_uid::text and kind='ride_payment' and direction='debit'
      and status='completed' and created_at>=now()-interval '24 hours';
  select coalesce(sum(abs(amount)),0) into v_amount_24h from public.wallet_transactions
    where user_id=v_uid::text and kind='ride_payment' and direction='debit'
      and status='completed' and created_at>=now()-interval '24 hours';

  if p_amount>=100000 then
    v_risk:=v_risk+70; v_reasons:=v_reasons||jsonb_build_array('high_amount');
  elsif p_amount>=50000 then
    v_risk:=v_risk+40; v_reasons:=v_reasons||jsonb_build_array('elevated_amount');
  end if;
  if v_recent_15m>=3 then
    v_risk:=v_risk+50; v_reasons:=v_reasons||jsonb_build_array('ride_velocity_15m');
  end if;
  if v_recent_24h>=8 then
    v_risk:=v_risk+30; v_reasons:=v_reasons||jsonb_build_array('ride_velocity_24h');
  end if;
  if v_amount_24h+p_amount>200000 then
    v_risk:=v_risk+40; v_reasons:=v_reasons||jsonb_build_array('daily_ride_value');
  end if;
  if not v_pin_set and p_amount>=50000 then
    v_risk:=v_risk+35; v_reasons:=v_reasons||jsonb_build_array('high_value_without_wallet_pin');
  end if;

  if v_risk>=70 then
    insert into public.wallet_risk_events(
      user_id,operation,amount,currency,reference_id,idempotency_key,decision,
      risk_score,reason_codes,metadata
    ) values (
      v_uid,'ride_payment',p_amount,p_currency,p_ride_id,v_key,'block',
      least(v_risk,100),v_reasons,
      jsonb_build_object('recent_15m',v_recent_15m,'recent_24h',v_recent_24h,
        'amount_24h',v_amount_24h,'pin_set',v_pin_set)
    );
    return jsonb_build_object('ok',false,'blocked',true,'code','RISK_BLOCKED',
      'risk_score',least(v_risk,100),'reason_codes',v_reasons);
  end if;

  if v_wallet.balance<p_amount then raise exception 'Insufficient wallet balance'; end if;
  if coalesce(v_wallet.spend_limit_enabled,false)
     and v_wallet.daily_spend_limit is not null
     and coalesce((
       select sum(abs(amount)) from public.wallet_transactions
       where user_id=v_uid::text and direction='debit' and status='completed'
         and created_at>=date_trunc('day',now())
     ),0)+p_amount>v_wallet.daily_spend_limit then
    raise exception 'Daily wallet spending limit exceeded';
  end if;

  update public.wallets set balance=balance-p_amount,updated_at=now() where id=v_wallet.id;
  insert into public.wallet_transactions(
    wallet_id,user_id,kind,type,amount,currency,direction,status,balance_before,
    balance_after,provider,description,payment_method,reference,idempotency_key,
    completed_at,created_at,updated_at,metadata
  ) values (
    v_wallet.id,v_uid::text,'ride_payment','ride_payment',p_amount,p_currency,'debit',
    'completed',v_wallet.balance,v_wallet.balance-p_amount,'testagram_wallet',
    'Ride payment','wallet','ride:'||p_ride_id::text,v_key,now(),now(),now(),
    jsonb_build_object('ride_id',p_ride_id,'fare',p_amount,'risk_score',v_risk)
  ) returning id into v_txid;

  insert into public.wallet_ledger(
    wallet_id,user_id,direction,amount_minor,currency,reason,reference_type,
    reference_id,idempotency_key,metadata
  ) values (
    v_wallet.id,v_uid::text,'debit',round(p_amount*100)::bigint,p_currency,
    'ride_payment','ride',p_ride_id,v_key,
    jsonb_build_object('wallet_transaction_id',v_txid,'risk_score',v_risk)
  );

  insert into public.wallet_risk_events(
    user_id,operation,amount,currency,reference_id,idempotency_key,decision,
    risk_score,reason_codes,metadata
  ) values (
    v_uid,'ride_payment',p_amount,p_currency,p_ride_id,v_key,'allow',v_risk,v_reasons,
    jsonb_build_object('recent_15m',v_recent_15m,'recent_24h',v_recent_24h,
      'amount_24h',v_amount_24h,'pin_set',v_pin_set)
  );

  return jsonb_build_object('ok',true,'duplicate',false,'transaction_id',v_txid,
    'status','completed','amount',p_amount,'currency',p_currency,'risk_score',v_risk);
end
$function$;

revoke execute on function public.wallet_pay_ride(uuid,numeric,text,text) from public, anon;
grant execute on function public.wallet_pay_ride(uuid,numeric,text,text) to authenticated;


-- Remove client access to provider callbacks and the legacy non-idempotent transfer overload.
revoke execute on function public.p2p_wallet_transfer(uuid,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.p2p_wallet_transfer(uuid,uuid,numeric,text) to service_role;

revoke execute on function public.reserve_mpesa_withdrawal(uuid,uuid,numeric,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.reserve_mpesa_withdrawal(uuid,uuid,numeric,text,text,numeric,text) to service_role;

revoke execute on function public.finalize_mpesa_topup(text,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_mpesa_topup(text,integer,text,text,jsonb) to service_role;

revoke execute on function public.finalize_mpesa_withdrawal(text,text,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_mpesa_withdrawal(text,text,integer,text,text,jsonb) to service_role;

revoke execute on function public.finalize_testagram_ad_mpesa_payment(text,integer,text,text,numeric,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.finalize_testagram_ad_mpesa_payment(text,integer,text,text,numeric,jsonb,jsonb) to service_role;

revoke execute on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;


-- Defense-in-depth: tables already had RLS enabled but no client policies.
-- Explicit restrictive deny policies preserve the existing deny-by-default behavior
-- while clearing the RLS-without-policy ambiguity in the security advisor.
do $$
declare r record;
begin
 for r in
   select tablename,schemaname
   from pg_tables t
   where schemaname in ('public','testagram_internal')
     and rowsecurity=true
     and not exists(select 1 from pg_policies p where p.schemaname=t.schemaname and p.tablename=t.tablename)
 loop
   execute format(
     'create policy %I on %I.%I as restrictive for all to anon, authenticated using (false) with check (false)',
     'deny_direct_client_access',r.schemaname,r.tablename
   );
 end loop;
end $$;

create index if not exists wallet_transactions_user_idempotency_idx
  on public.wallet_transactions(user_id,idempotency_key)
  where idempotency_key is not null;
create unique index if not exists reward_events_idempotency_uidx
  on public.reward_events(idempotency_key)
  where idempotency_key is not null;
create index if not exists wallet_risk_events_decision_created_idx
  on public.wallet_risk_events(decision,created_at desc);

create or replace function public.claim_daily_reward()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_user_id uuid:=auth.uid(); v_today date:=(now() at time zone 'utc')::date;
 v_reward public.daily_rewards%rowtype; v_wallet public.user_wallets%rowtype;
 v_event_id uuid:=gen_random_uuid(); v_day integer; v_credits integer; v_idempotency text;
begin
 if v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
 perform pg_advisory_xact_lock(hashtext('daily-reward:'||v_user_id::text||':'||v_today::text));
 select * into v_reward from public.daily_rewards where user_id=v_user_id for update;
 if v_reward.user_id is not null and (v_reward.last_claimed_at at time zone 'utc')::date=v_today then
   raise exception using errcode='23505',message='DAILY_REWARD_ALREADY_CLAIMED';
 end if;
 v_day:=case when v_reward.user_id is null or v_reward.last_claimed_at is null then 1
   when (v_reward.last_claimed_at at time zone 'utc')::date=v_today-1 then case when v_reward.streak_day>=7 then 1 else v_reward.streak_day+1 end
   else 1 end;
 v_credits:=case v_day when 1 then 10 when 2 then 15 when 3 then 20 when 4 then 25 when 5 then 30 when 6 then 40 when 7 then 50 else 10 end;
 v_idempotency:='daily-reward:'||v_user_id::text||':'||v_today::text;
 insert into public.user_wallets(user_id,credits,updated_at) values(v_user_id,v_credits,now())
 on conflict(user_id) do update set credits=public.user_wallets.credits+excluded.credits,updated_at=now() returning * into v_wallet;
 insert into public.daily_rewards(user_id,streak_day,credits_earned,last_claimed_at,updated_at)
 values(v_user_id,v_day,v_credits,now(),now())
 on conflict(user_id) do update set streak_day=excluded.streak_day,credits_earned=excluded.credits_earned,last_claimed_at=excluded.last_claimed_at,updated_at=now()
 returning * into v_reward;
 insert into public.reward_events(id,user_id,reward_type,amount_minor,currency,source,source_id,idempotency_key,created_at)
 values(v_event_id,v_user_id,'daily_streak',v_credits,'CREDITS','daily_rewards',v_event_id,v_idempotency,now())
 on conflict(idempotency_key) do nothing;
 return jsonb_build_object('ok',true,'streak_day',v_reward.streak_day,'credits_earned',v_credits,'wallet_credits',v_wallet.credits,'claimed_at',v_reward.last_claimed_at);
end;
$function$;

revoke execute on function public.claim_daily_reward() from public,anon;
grant execute on function public.claim_daily_reward() to authenticated;

create or replace function public.claim_rewarded_ad(p_idempotency_key text)
returns table(ok boolean,credits_earned bigint,wallet_credits bigint,streak_count integer,claimed_at timestamptz)
language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid(); v_existing record; v_today_count integer;
 v_credits bigint:=25; v_wallet bigint:=0; v_now timestamptz:=now();
begin
 if v_user is null then raise exception 'REWARDED_AD_AUTH_REQUIRED'; end if;
 if p_idempotency_key is null or length(trim(p_idempotency_key))<16 or length(trim(p_idempotency_key))>128
    or trim(p_idempotency_key)!~'^[A-Za-z0-9:_-]+$' then raise exception 'REWARDED_AD_INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtext('rewarded-ad:'||v_user::text||':'||trim(p_idempotency_key)));
 select id,amount_minor into v_existing from public.reward_events where user_id=v_user and idempotency_key=trim(p_idempotency_key) limit 1;
 if found then
   select coalesce(credits,0) into v_wallet from public.user_wallets where user_id=v_user;
   select count(*)::integer into v_today_count from public.reward_events where user_id=v_user and source='rewarded_ads'
     and created_at>=date_trunc('day',v_now) and created_at<date_trunc('day',v_now)+interval '1 day';
   return query select true,v_existing.amount_minor,v_wallet,v_today_count,v_now; return;
 end if;
 select count(*)::integer into v_today_count from public.reward_events where user_id=v_user and source='rewarded_ads'
   and created_at>=date_trunc('day',v_now) and created_at<date_trunc('day',v_now)+interval '1 day';
 if v_today_count>=10 then raise exception 'REWARDED_AD_DAILY_LIMIT'; end if;
 if v_today_count>=2 then v_credits:=40; end if;
 insert into public.reward_events(user_id,reward_type,amount_minor,currency,source,idempotency_key)
 values(v_user,'rewarded_ad',v_credits,'CREDITS','rewarded_ads',trim(p_idempotency_key));
 insert into public.user_wallets(user_id,credits) values(v_user,v_credits)
 on conflict(user_id) do update set credits=public.user_wallets.credits+excluded.credits,updated_at=now();
 select credits into v_wallet from public.user_wallets where user_id=v_user;
 return query select true,v_credits,v_wallet,v_today_count+1,v_now;
end;
$function$;

revoke execute on function public.claim_rewarded_ad(text) from public,anon;
grant execute on function public.claim_rewarded_ad(text) to authenticated;
