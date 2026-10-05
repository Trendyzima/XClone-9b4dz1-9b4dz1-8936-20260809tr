create or replace function public.wallet_pay_ride(
  p_ride_id uuid,
  p_amount numeric,
  p_currency text default 'KES',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  w wallets%rowtype;
  amount numeric := round(p_amount, 2);
  currency_code text := upper(coalesce(nullif(trim(p_currency), ''), 'KES'));
  debit numeric;
  before_balance numeric;
  after_balance numeric;
  existing jsonb;
  key text := nullif(trim(p_idempotency_key), '');
  rate numeric := 130;
  tx_id uuid := gen_random_uuid();
begin
  if u is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;
  if p_ride_id is null then
    raise exception using errcode='22023', message='Ride ID is required';
  end if;
  if amount is null or amount <= 0 then
    raise exception using errcode='22023', message='Ride amount must be greater than zero';
  end if;
  if currency_code not in ('KES','USD','EUR') then
    raise exception using errcode='22023', message='Unsupported ride currency';
  end if;

  if key is null then raise exception using errcode='22023',message='Idempotency key is required'; end if;
  if key is not null then
    select jsonb_build_object(
      'success', true,
      'payment_id', id,
      'status', status,
      'amount', amount,
      'currency', currency,
      'ride_id', metadata->>'ride_id'
    )
    into existing
    from wallet_transactions
    where user_id=u::text
      and idempotency_key=key
      and kind='ride_payment'
      and direction='out'
    limit 1;
    if existing is not null then return existing; end if;
  end if;

  select * into w
  from wallets
  where user_id=u::text
  for update;

  if w.id is null then
    raise exception using errcode='P0002', message='Payment wallet not found';
  end if;
  if coalesce(w.status,'active') <> 'active' then
    raise exception using errcode='22023', message='Wallet is not active';
  end if;
  if coalesce(w.spending_enabled,true) = false then
    raise exception using errcode='22023', message='Wallet spending is disabled';
  end if;

  debit := case
    when upper(coalesce(w.currency,'USD')) = currency_code then amount
    when upper(coalesce(w.currency,'USD')) = 'USD' and currency_code='KES' then round(amount/rate, 2)
    when upper(coalesce(w.currency,'USD')) = 'USD' and currency_code='EUR' then round(amount/0.92, 2)
    when upper(coalesce(w.currency,'USD')) = 'KES' and currency_code='USD' then round(amount*rate, 2)
    else amount
  end;

  before_balance := coalesce(w.balance,0);

  if coalesce(w.spend_limit_enabled,false) and w.daily_spend_limit is not null then
    if (
      select coalesce(sum(abs(amount)),0)
      from wallet_transactions
      where user_id=u::text
        and direction='out'
        and status='completed'
        and created_at >= date_trunc('day', now())
    ) + debit > w.daily_spend_limit then
      raise exception using errcode='22003', message='Daily wallet spending limit reached';
    end if;
  end if;

  if before_balance < debit then
    raise exception using errcode='22003', message='Insufficient wallet balance';
  end if;

  after_balance := before_balance - debit;

  update wallets
  set balance=after_balance, updated_at=now()
  where id=w.id;

  insert into wallet_transactions(
    id,wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,
    balance_before,balance_after,description,metadata,payment_method,reference,
    idempotency_key,completed_at
  ) values (
    tx_id,w.id,u::text,'ride_payment','ride_payment',debit,(debit*100)::bigint,
    upper(coalesce(w.currency,'USD')),'out','completed',before_balance,after_balance,
    'Testagram Ride payment',
    jsonb_build_object(
      'ride_id',p_ride_id::text,
      'charged_amount',amount,
      'charged_currency',currency_code,
      'fx_rate_kes_per_usd',rate
    ),
    'wallet','RIDE-'||upper(replace(tx_id::text,'-','')),key,now()
  );

  return jsonb_build_object(
    'success',true,
    'payment_id',tx_id,
    'ride_id',p_ride_id,
    'amount',amount,
    'currency',currency_code,
    'debited',debit,
    'wallet_currency',upper(coalesce(w.currency,'USD')),
    'balance_after',after_balance,
    'status','completed'
  );
end;
$$;

revoke all on function public.wallet_pay_ride(uuid,numeric,text,text) from public;
grant execute on function public.wallet_pay_ride(uuid,numeric,text,text) to authenticated;


create or replace function public.wallet_pay_ride(
  p_ride_id uuid,
  p_amount numeric,
  p_currency text default 'KES',
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  u uuid:=auth.uid(); w wallets%rowtype; amount numeric:=round(p_amount,2);
  currency_code text:=upper(coalesce(nullif(trim(p_currency),''),'KES'));
  debit numeric; before_balance numeric; after_balance numeric; existing jsonb;
  key text:=nullif(trim(p_idempotency_key),''); rate numeric:=130; tx_id uuid:=gen_random_uuid();
begin
  if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_ride_id is null or amount is null or amount<=0 then raise exception using errcode='22023',message='Invalid ride payment'; end if;
  if currency_code not in ('KES','USD','EUR') then raise exception using errcode='22023',message='Unsupported ride currency'; end if;
  if key is not null then
    select jsonb_build_object('success',true,'payment_id',id,'status',status,'amount',metadata->>'charged_amount','currency',metadata->>'charged_currency','ride_id',metadata->>'ride_id')
      into existing from wallet_transactions where user_id=u::text and idempotency_key=key and kind='ride_payment' and direction='out' limit 1;
    if existing is not null then return existing; end if;
  end if;
  select * into w from wallets where user_id=u::text for update;
  if w.id is null then raise exception using errcode='P0002',message='Payment wallet not found'; end if;
  if coalesce(w.status,'active')<>'active' or coalesce(w.spending_enabled,true)=false then raise exception using errcode='22023',message='Wallet spending is unavailable'; end if;
  debit:=case
    when upper(coalesce(w.currency,'USD'))=currency_code then amount
    when upper(coalesce(w.currency,'USD'))='USD' and currency_code='KES' then round(amount/rate,2)
    when upper(coalesce(w.currency,'USD'))='USD' and currency_code='EUR' then round(amount/0.92,2)
    when upper(coalesce(w.currency,'USD'))='KES' and currency_code='USD' then round(amount*rate,2)
    else amount end;
  before_balance:=coalesce(w.balance,0);
  if coalesce(w.spend_limit_enabled,false) and w.daily_spend_limit is not null and
     (select coalesce(sum(abs(amount)),0) from wallet_transactions where user_id=u::text and direction='out' and status='completed' and created_at>=date_trunc('day',now()))+debit>w.daily_spend_limit
  then raise exception using errcode='22003',message='Daily wallet spending limit reached'; end if;
  if before_balance<debit then raise exception using errcode='22003',message='Insufficient wallet balance'; end if;
  after_balance:=before_balance-debit;
  update wallets set balance=after_balance,updated_at=now() where id=w.id;
  insert into wallet_transactions(id,wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,description,metadata,payment_method,reference,idempotency_key,completed_at)
  values(tx_id,w.id,u::text,'ride_payment','ride_payment',debit,(debit*100)::bigint,upper(coalesce(w.currency,'USD')),'out','completed',before_balance,after_balance,'Testagram Ride payment',
    jsonb_build_object('ride_id',p_ride_id::text,'charged_amount',amount,'charged_currency',currency_code,'fx_rate_kes_per_usd',rate),
    'wallet','RIDE-'||upper(replace(tx_id::text,'-','')),key,now());
  return jsonb_build_object('success',true,'payment_id',tx_id,'ride_id',p_ride_id,'amount',amount,'currency',currency_code,'debited',debit,'wallet_currency',upper(coalesce(w.currency,'USD')),'balance_after',after_balance,'status','completed');
end; $$;
revoke all on function public.wallet_pay_ride(uuid,numeric,text,text) from public;
grant execute on function public.wallet_pay_ride(uuid,numeric,text,text) to authenticated;
