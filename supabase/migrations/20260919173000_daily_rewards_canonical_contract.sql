-- Canonical daily-reward contract.
-- One UTC claim per user/day, atomically updating streak + credits + immutable reward event.
create or replace function public.claim_daily_reward()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_reward public.daily_rewards%rowtype;
  v_wallet public.user_wallets%rowtype;
  v_event_id uuid := gen_random_uuid();
  v_day integer;
  v_credits integer;
  v_idempotency text;
begin
  if v_user_id is null then
    raise exception using errcode='28000', message='Authentication required';
  end if;

  -- Lock the user's wallet first. This serializes concurrent first-time claims
  -- before the daily_rewards row necessarily exists, preventing double credits.
  insert into public.user_wallets(user_id, credits, updated_at)
  values(v_user_id, 0, now())
  on conflict(user_id) do update set updated_at = public.user_wallets.updated_at
  returning * into v_wallet;

  select * into v_reward
  from public.daily_rewards
  where user_id = v_user_id
  for update;

  if v_reward.user_id is not null
     and v_reward.last_claimed_at is not null
     and (v_reward.last_claimed_at at time zone 'utc')::date = v_today then
    raise exception using errcode='23505', message='DAILY_REWARD_ALREADY_CLAIMED';
  end if;

  v_day := case
    when v_reward.user_id is null or v_reward.last_claimed_at is null then 1
    when (v_reward.last_claimed_at at time zone 'utc')::date = v_today - 1 then
      case when v_reward.streak_day >= 7 then 1 else v_reward.streak_day + 1 end
    else 1
  end;

  v_credits := case v_day
    when 1 then 10
    when 2 then 15
    when 3 then 20
    when 4 then 25
    when 5 then 30
    when 6 then 40
    when 7 then 50
    else 10
  end;

  v_idempotency := 'daily-reward:' || v_user_id::text || ':' || v_today::text;

  update public.user_wallets
  set credits = credits + v_credits, updated_at = now()
  where user_id = v_user_id
  returning * into v_wallet;

  insert into public.daily_rewards(user_id, streak_day, credits_earned, last_claimed_at, updated_at)
  values(v_user_id, v_day, v_credits, now(), now())
  on conflict(user_id) do update
    set streak_day = excluded.streak_day,
        credits_earned = excluded.credits_earned,
        last_claimed_at = excluded.last_claimed_at,
        updated_at = now()
  returning * into v_reward;

  insert into public.reward_events(
    id,user_id,reward_type,amount_minor,currency,source,source_id,idempotency_key,created_at
  )
  values(
    v_event_id,v_user_id,'daily_streak',v_credits,'CREDITS','daily_rewards',v_event_id,v_idempotency,now()
  )
  on conflict(idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'streak_day', v_reward.streak_day,
    'credits_earned', v_credits,
    'wallet_credits', v_wallet.credits,
    'claimed_at', v_reward.last_claimed_at
  );
exception
  when unique_violation then
    if sqlerrm like '%daily-reward:%' then
      raise exception using errcode='23505', message='DAILY_REWARD_ALREADY_CLAIMED';
    end if;
    raise;
end;
$$;

revoke all on function public.claim_daily_reward() from public, anon, authenticated;
grant execute on function public.claim_daily_reward() to authenticated;

-- Browser clients may read their reward state, but cannot mint credits or rewrite reward history.
revoke insert, update, delete on public.daily_rewards from authenticated;
revoke insert, update, delete on public.user_wallets from authenticated;
revoke insert, update, delete on public.reward_events from authenticated;
grant select on public.daily_rewards, public.user_wallets, public.reward_events to authenticated;

insert into public.capability_registry(name,version,access,readonly,enabled,description)
values('testagram.daily_rewards.claim',1,'authenticated',false,true,'Atomically claim one UTC daily streak reward')
on conflict(name) do update
set version=excluded.version, access=excluded.access, readonly=excluded.readonly,
    enabled=true, description=excluded.description, updated_at=now();
