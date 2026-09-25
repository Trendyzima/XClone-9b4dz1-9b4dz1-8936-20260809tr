create unique index if not exists referrals_active_code_key
  on public.referrals (code)
  where referred_id is null;

create unique index if not exists referrals_referred_user_key
  on public.referrals (referred_id)
  where referred_id is not null;

revoke all on table public.referrals from anon, authenticated;
grant select on table public.referrals to authenticated;

create or replace function public.ensure_referral_code()
returns text
language plpgsql
security definer
set search_path to pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_code text;
begin
  if v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  select r.code into v_code
  from public.referrals r
  where r.referrer_id = v_user_id and r.referred_id is null
  limit 1;

  if v_code is not null then return v_code; end if;

  v_code := upper(substr(replace(v_user_id::text,'-',''),1,10));

  insert into public.referrals(id, referrer_id, referred_id, code, status)
  values(gen_random_uuid(), v_user_id, null, v_code, 'code')
  on conflict (code) where referred_id is null do nothing;

  select r.code into v_code
  from public.referrals r
  where r.referrer_id = v_user_id and r.referred_id is null
  limit 1;

  return v_code;
end;
$function$;

create or replace function public.complete_referral()
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_ref public.referrals%rowtype;
  v_amount bigint := 100;
  v_key text;
  v_ref_event_id uuid;
  v_referred_event_id uuid;
  v_ref_wallet bigint;
  v_self_wallet bigint;
begin
  if v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  select * into v_ref
  from public.referrals
  where referred_id = v_user_id and status = 'pending'
  for update;

  if v_ref.id is null then
    return jsonb_build_object(
      'ok', true,
      'completed', false,
      'reason', case
        when exists(select 1 from public.referrals where referred_id = v_user_id and status = 'completed')
          then 'ALREADY_COMPLETED'
        else 'NO_PENDING_REFERRAL'
      end
    );
  end if;

  v_key := 'referral:' || v_ref.id::text;

  insert into public.reward_events(
    id, user_id, reward_type, amount_minor, currency, source, source_id, idempotency_key, created_at
  )
  values(
    gen_random_uuid(), v_ref.referrer_id, 'referral', v_amount, 'CREDITS', 'referrals', v_ref.id, v_key, now()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ref_event_id;

  if v_ref_event_id is not null then
    insert into public.user_wallets(user_id, credits, updated_at)
    values(v_ref.referrer_id, v_amount, now())
    on conflict(user_id) do update
      set credits = public.user_wallets.credits + excluded.credits, updated_at = now()
    returning credits into v_ref_wallet;
  else
    select credits into v_ref_wallet from public.user_wallets where user_id = v_ref.referrer_id;
  end if;

  insert into public.reward_events(
    id, user_id, reward_type, amount_minor, currency, source, source_id, idempotency_key, created_at
  )
  values(
    gen_random_uuid(), v_user_id, 'referral_signup', v_amount, 'CREDITS', 'referrals', v_ref.id, v_key || ':referred', now()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_referred_event_id;

  if v_referred_event_id is not null then
    insert into public.user_wallets(user_id, credits, updated_at)
    values(v_user_id, v_amount, now())
    on conflict(user_id) do update
      set credits = public.user_wallets.credits + excluded.credits, updated_at = now()
    returning credits into v_self_wallet;
  else
    select credits into v_self_wallet from public.user_wallets where user_id = v_user_id;
  end if;

  update public.referrals
  set status='completed',
      completed_at=coalesce(completed_at, now()),
      reward_amount_minor=v_amount,
      reward_currency='CREDITS',
      reward_idempotency_key=v_key
  where id=v_ref.id;

  return jsonb_build_object(
    'ok', true, 'completed', true, 'reward_credits', v_amount,
    'referrer_id', v_ref.referrer_id,
    'referrer_wallet_credits', v_ref_wallet,
    'referred_wallet_credits', v_self_wallet
  );
end;
$function$;

revoke all on function public.ensure_referral_code() from public, anon;
grant execute on function public.ensure_referral_code() to authenticated;

revoke all on function public.complete_referral() from public, anon;
grant execute on function public.complete_referral() to authenticated;
