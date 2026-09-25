create or replace function public.claim_rewarded_ad(p_idempotency_key text)
returns table(ok boolean, credits_earned bigint, wallet_credits bigint, streak_count integer, claimed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing record;
  v_today_count integer;
  v_credits bigint := 25;
  v_wallet bigint := 0;
  v_now timestamptz := now();
begin
  if v_user is null then raise exception 'REWARDED_AD_AUTH_REQUIRED'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 16 then raise exception 'REWARDED_AD_INVALID_REQUEST'; end if;

  select id, amount_minor into v_existing
  from public.reward_events
  where idempotency_key = p_idempotency_key
  limit 1;

  if found then
    select coalesce(credits,0) into v_wallet from public.user_wallets where user_id = v_user;
    select count(*)::integer into v_today_count
      from public.reward_events
      where user_id = v_user and source = 'rewarded_ads'
        and created_at >= date_trunc('day', v_now)
        and created_at < date_trunc('day', v_now) + interval '1 day';
    return query select true,v_existing.amount_minor,v_wallet,v_today_count,v_now;
    return;
  end if;

  select count(*)::integer into v_today_count
  from public.reward_events
  where user_id = v_user and source = 'rewarded_ads'
    and created_at >= date_trunc('day', v_now)
    and created_at < date_trunc('day', v_now) + interval '1 day';

  if v_today_count >= 10 then raise exception 'REWARDED_AD_DAILY_LIMIT'; end if;
  if v_today_count >= 2 then v_credits := 40; end if;

  insert into public.reward_events(user_id,reward_type,amount_minor,currency,source,idempotency_key)
  values(v_user,'rewarded_ad',v_credits,'CREDITS','rewarded_ads',p_idempotency_key);

  insert into public.user_wallets(user_id,credits)
  values(v_user,v_credits)
  on conflict(user_id) do update
    set credits = public.user_wallets.credits + excluded.credits,
        updated_at = now();

  select credits into v_wallet from public.user_wallets where user_id = v_user;
  return query select true,v_credits,v_wallet,v_today_count + 1,v_now;
end;
$$;

revoke all on function public.claim_rewarded_ad(text) from public, anon;
grant execute on function public.claim_rewarded_ad(text) to authenticated;
