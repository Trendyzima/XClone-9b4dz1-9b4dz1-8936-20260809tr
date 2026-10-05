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
