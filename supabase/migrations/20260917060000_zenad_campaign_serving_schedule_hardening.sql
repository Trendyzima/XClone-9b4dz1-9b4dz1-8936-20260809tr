-- ZenAd P0 hardening: funded campaigns must respect their configured schedule.
-- Payment settlement may mark a campaign active immediately, but serving is gated by starts_at/ends_at.

create or replace function public.zenad_claim_impression(
  p_request_id text,
  p_impression_id text,
  p_app_id text,
  p_slot_code text,
  p_campaign_id uuid,
  p_creative_id uuid,
  p_user_id uuid,
  p_billable_micros bigint,
  p_consent jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daily date := current_date;
  v_spend bigint := 0;
  v_lifetime bigint := 0;
  v_budget bigint;
  v_daily_budget bigint;
  v_window timestamptz;
  v_count integer := 0;
  v_cap integer := 0;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_payment_status text;
  v_currency text;
begin
  if p_billable_micros <= 0 then return false; end if;

  select lifetime_budget_micros, daily_budget_micros, starts_at, ends_at,
         payment_status, currency
    into v_budget, v_daily_budget, v_starts_at, v_ends_at,
         v_payment_status, v_currency
  from public.zenad_campaigns
  where id = p_campaign_id
    and status = 'active'
  for update;

  if not found then return false; end if;
  if v_payment_status <> 'funded' then return false; end if;
  if upper(coalesce(v_currency,'')) <> 'KES' then return false; end if;
  if v_starts_at is not null and now() < v_starts_at then return false; end if;
  if v_ends_at is not null and now() >= v_ends_at then return false; end if;

  if exists(
    select 1
    from public.zenad_slots s
    where s.app_id = p_app_id
      and s.code = p_slot_code
      and s.enabled = true
      and (select bid_cpm_micros from public.zenad_campaigns where id = p_campaign_id) < s.floor_cpm_micros
  ) then return false; end if;

  select coalesce(sum(spend_micros),0)
    into v_lifetime
  from public.zenad_daily_spend
  where campaign_id = p_campaign_id;
  if v_budget is not null and v_lifetime + p_billable_micros > v_budget then return false; end if;

  select coalesce(spend_micros,0)
    into v_spend
  from public.zenad_daily_spend
  where campaign_id = p_campaign_id and spend_date = v_daily
  for update;
  if v_spend is null then v_spend := 0; end if;
  if v_daily_budget is not null and v_spend + p_billable_micros > v_daily_budget then return false; end if;

  v_window := date_trunc('day', now());
  if p_user_id is not null then
    select coalesce((targeting->'frequencyCap'->>'maxImpressions')::integer,0)
      into v_cap
    from public.zenad_campaigns
    where id = p_campaign_id;
    if v_cap > 0 then
      select impressions into v_count
      from public.zenad_frequency
      where user_id = p_user_id
        and campaign_id = p_campaign_id
        and window_start = v_window
      for update;
      if coalesce(v_count,0) >= v_cap then return false; end if;
    end if;
  end if;

  insert into public.zenad_daily_spend(campaign_id, spend_date, spend_micros, impressions)
  values(p_campaign_id, v_daily, p_billable_micros, 1)
  on conflict(campaign_id, spend_date) do update
    set spend_micros = public.zenad_daily_spend.spend_micros + excluded.spend_micros,
        impressions = public.zenad_daily_spend.impressions + 1;

  insert into public.zenad_impressions(
    request_id, impression_id, app_id, slot_code, campaign_id, creative_id,
    user_id, billable_micros, consent, metadata
  ) values(
    p_request_id, p_impression_id, p_app_id, p_slot_code, p_campaign_id,
    p_creative_id, p_user_id, p_billable_micros, p_consent, p_metadata
  );

  if p_user_id is not null and v_cap > 0 then
    insert into public.zenad_frequency(user_id,campaign_id,window_start,impressions)
    values(p_user_id,p_campaign_id,v_window,1)
    on conflict(user_id,campaign_id,window_start) do update
      set impressions = public.zenad_frequency.impressions + 1;
  end if;
  return true;
end;
$$;

revoke all on function public.zenad_claim_impression(text,text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) from public;
grant execute on function public.zenad_claim_impression(text,text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) to authenticated, service_role;
