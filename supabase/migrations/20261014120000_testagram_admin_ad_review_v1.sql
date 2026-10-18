-- Secure review workflow for Testagram-owned ad campaigns.
-- Legacy public.user_ads RLS is advertiser-owned; admin review uses this explicit RPC contract.
alter table public.testagram_ad_campaigns
  add column if not exists moderation_status text not null default 'pending',
  add column if not exists moderation_note text,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null,
  add column if not exists moderated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'testagram_ad_campaigns_moderation_status_check'
      and conrelid = 'public.testagram_ad_campaigns'::regclass
  ) then
    alter table public.testagram_ad_campaigns
      add constraint testagram_ad_campaigns_moderation_status_check
      check (moderation_status in ('pending','approved','rejected'));
  end if;
end $$;

alter table public.testagram_ad_campaigns
  drop constraint if exists testagram_ad_campaigns_status_check;
alter table public.testagram_ad_campaigns
  add constraint testagram_ad_campaigns_status_check
  check (status in ('draft','pending_payment','pending_review','active','paused','completed','rejected','archived'));

-- Preserve existing serving state instead of unexpectedly unpublishing live, funded campaigns.
update public.testagram_ad_campaigns
set moderation_status = 'approved', moderated_at = coalesce(moderated_at, updated_at)
where status = 'active' and payment_status = 'funded' and moderation_status = 'pending';

create index if not exists testagram_ad_campaigns_moderation_idx
  on public.testagram_ad_campaigns(moderation_status, created_at desc);

create or replace function public.testagram_admin_list_ad_review_queue(p_status text default 'pending')
returns table (
  campaign_id uuid,
  advertiser_id uuid,
  advertiser_name text,
  owner_user_id uuid,
  campaign_name text,
  objective text,
  campaign_status text,
  payment_status text,
  currency text,
  lifetime_budget_micros bigint,
  funded_micros bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  moderation_status text,
  moderation_note text,
  creative_id uuid,
  headline text,
  creative_body text,
  asset_url text,
  click_through_url text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.testagram_is_owner()
     and not public.testagram_has_permission('platform.ads') then
    raise exception 'FORBIDDEN: platform.ads permission required';
  end if;
  if coalesce(p_status,'') not in ('pending','approved','rejected','all') then
    raise exception 'Invalid moderation status';
  end if;
  return query
  select c.id, a.id, a.name, a.owner_user_id, c.name, c.objective,
         c.status, c.payment_status, c.currency, c.lifetime_budget_micros,
         c.funded_micros, c.starts_at, c.ends_at, c.created_at,
         c.moderation_status, c.moderation_note,
         cr.id, cr.headline, cr.body, cr.asset_url, cr.click_through_url
  from public.testagram_ad_campaigns c
  join public.testagram_advertisers a on a.id = c.advertiser_id
  left join lateral (
    select x.id, x.headline, x.body, x.asset_url, x.click_through_url
    from public.testagram_ad_creatives x
    where x.campaign_id = c.id
    order by x.created_at asc
    limit 1
  ) cr on true
  where p_status = 'all' or c.moderation_status = p_status
  order by c.created_at desc
  limit 200;
end;
$$;

create or replace function public.testagram_admin_review_ad_campaign(
  p_campaign_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_campaign public.testagram_ad_campaigns%rowtype;
  v_owner uuid;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not public.testagram_is_owner()
     and not public.testagram_has_permission('platform.ads') then
    raise exception 'FORBIDDEN: platform.ads permission required';
  end if;
  perform public.testagram_require_privileged_session();
  if coalesce(p_decision,'') not in ('approved','rejected') then raise exception 'Invalid review decision'; end if;
  if p_decision = 'rejected' and v_note is null then raise exception 'A rejection reason is required'; end if;
  if length(coalesce(v_note,'')) > 500 then raise exception 'Review note must be 500 characters or fewer'; end if;

  -- A composite row variable cannot share a multi-target INTO list with
  -- scalar variables in PL/pgSQL. Fetch the campaign row and owner separately.
  select c.* into v_campaign
  from public.testagram_ad_campaigns c
  where c.id = p_campaign_id
  for update;
  if not found then raise exception 'Campaign not found'; end if;

  select a.owner_user_id into v_owner
  from public.testagram_advertisers a
  where a.id = v_campaign.advertiser_id;
  if not found then raise exception 'Campaign advertiser not found'; end if;

  v_status := case
    when p_decision = 'rejected' then 'rejected'
    when v_campaign.payment_status = 'funded' and v_campaign.ends_at is not null and v_campaign.ends_at <= now() then 'completed'
    when v_campaign.payment_status = 'funded' and v_campaign.status = 'paused' then 'paused'
    when v_campaign.payment_status = 'funded' then 'active'
    else 'pending_payment'
  end;

  update public.testagram_ad_campaigns
  set moderation_status = p_decision,
      moderation_note = v_note,
      moderated_by = v_uid,
      moderated_at = now(),
      status = case when p_decision = 'rejected' then 'rejected'
                    when v_campaign.payment_status = 'funded' and v_campaign.ends_at is not null and v_campaign.ends_at <= now() then 'completed'
                    when v_campaign.payment_status = 'funded' and v_campaign.status = 'paused' then 'paused'
                    when v_campaign.payment_status = 'funded' then 'active'
                    else 'pending_payment' end,
      updated_at = now()
  where id = p_campaign_id;

  insert into public.platform_inbox(user_id, type, subject, body, icon_emoji, cta_label, cta_url, metadata)
  values (
    v_owner,
    'update',
    case when p_decision = 'approved' then 'Your ad campaign was approved' else 'Your ad campaign was rejected' end,
    case when p_decision = 'approved'
      then case when v_campaign.payment_status = 'funded'
        then 'Your campaign "' || v_campaign.name || '" was approved and is eligible to serve.'
        else 'Your campaign "' || v_campaign.name || '" was approved. Complete payment before it can serve.' end
      else 'Your campaign "' || v_campaign.name || '" was rejected. Reason: ' || v_note end,
    case when p_decision = 'approved' then '✅' else '⚠️' end,
    'View my ads',
    '/my-ads',
    jsonb_build_object('campaign_id',p_campaign_id,'moderation_status',p_decision,'campaign_status',v_status)
  );

  insert into public.testagram_governance_audit_log(actor_user_id, action, target_user_id, reason, metadata)
  values (v_uid, 'ads.campaign.reviewed', v_owner, coalesce(v_note, 'Ad campaign approved'),
    jsonb_build_object('campaign_id',p_campaign_id,'decision',p_decision,'payment_status',v_campaign.payment_status,'resulting_status',v_status));

  return jsonb_build_object('success',true,'campaign_id',p_campaign_id,'moderation_status',p_decision,'campaign_status',v_status,'payment_status',v_campaign.payment_status);
end;
$$;

revoke all on function public.testagram_admin_list_ad_review_queue(text) from public, anon;
revoke all on function public.testagram_admin_review_ad_campaign(uuid,text,text) from public, anon;
grant execute on function public.testagram_admin_list_ad_review_queue(text) to authenticated;
grant execute on function public.testagram_admin_review_ad_campaign(uuid,text,text) to authenticated;


-- Paid campaigns cannot serve until moderation explicitly approves them.
create or replace function public.testagram_claim_ad_impression(
  p_request_id text,p_impression_id text,p_slot_code text,p_campaign_id uuid,p_creative_id uuid,p_user_id uuid,p_billable_micros bigint,p_consent jsonb default '{}'::jsonb,p_metadata jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_daily date:=current_date; v_spend bigint:=0; v_lifetime bigint; v_daily_budget bigint; v_window timestamptz:=date_trunc('day',now()); v_count integer:=0; v_cap integer:=0; v_floor bigint;
begin
 select floor_cpm_micros into v_floor from public.testagram_ad_slots where code=p_slot_code and enabled=true;
 if not found then return false; end if;
 select lifetime_budget_micros,daily_budget_micros,coalesce((targeting->'frequencyCap'->>'maxImpressions')::integer,0) into v_lifetime,v_daily_budget,v_cap from public.testagram_ad_campaigns where id=p_campaign_id and moderation_status='approved' and status='active' and payment_status='funded' and starts_at<=now() and (ends_at is null or ends_at>=now()) for update;
 if not found or p_billable_micros < v_floor then return false; end if;
 select coalesce(sum(spend_micros),0) into v_spend from public.testagram_ad_daily_spend where campaign_id=p_campaign_id;
 if v_lifetime is not null and v_spend+p_billable_micros>v_lifetime then return false; end if;
 if v_daily_budget is not null then select coalesce(spend_micros,0) into v_spend from public.testagram_ad_daily_spend where campaign_id=p_campaign_id and spend_date=v_daily for update; if coalesce(v_spend,0)+p_billable_micros>v_daily_budget then return false; end if; end if;
 if p_user_id is not null and v_cap>0 then select impressions into v_count from public.testagram_ad_frequency where user_id=p_user_id and campaign_id=p_campaign_id and window_start=v_window for update; if coalesce(v_count,0)>=v_cap then return false; end if; end if;
 insert into public.testagram_ad_daily_spend(campaign_id,spend_date,spend_micros,impressions) values(p_campaign_id,v_daily,p_billable_micros,1) on conflict(campaign_id,spend_date) do update set spend_micros=public.testagram_ad_daily_spend.spend_micros+excluded.spend_micros,impressions=public.testagram_ad_daily_spend.impressions+1;
 insert into public.testagram_ad_impressions(request_id,impression_id,slot_code,campaign_id,creative_id,user_id,billable_micros,consent,metadata) values(p_request_id,p_impression_id,p_slot_code,p_campaign_id,p_creative_id,p_user_id,p_billable_micros,coalesce(p_consent,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb));
 if p_user_id is not null and v_cap>0 then insert into public.testagram_ad_frequency(user_id,campaign_id,window_start,impressions) values(p_user_id,p_campaign_id,v_window,1) on conflict(user_id,campaign_id,window_start) do update set impressions=public.testagram_ad_frequency.impressions+1; end if;
 return true;
end; $$;

CREATE OR REPLACE FUNCTION public.finalize_testagram_ad_mpesa_payment(
  p_checkout_request_id text,
  p_result_code integer,
  p_receipt_number text,
  p_result_description text,
  p_amount_kes numeric,
  p_callback_data jsonb DEFAULT '{}'::jsonb,
  p_provider_response jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  p public.testagram_ad_payments%rowtype;
  c public.testagram_ad_campaigns%rowtype;
  a public.testagram_advertisers%rowtype;
  w public.wallets%rowtype;
  wt public.wallet_transactions%rowtype;
  before_balance numeric;
  after_credit numeric;
  spend_amount numeric;
begin
  if nullif(btrim(p_checkout_request_id),'') is null then
    return jsonb_build_object('ok',false,'reason','checkout_request_id_required');
  end if;

  select * into p
  from public.testagram_ad_payments
  where checkout_request_id=p_checkout_request_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','payment_not_found');
  end if;

  select * into c
  from public.testagram_ad_campaigns
  where id=p.campaign_id
  for update;

  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  select * into a
  from public.testagram_advertisers
  where id=c.advertiser_id
  for share;

  if not found or a.owner_user_id is distinct from p.user_id then
    raise exception 'CAMPAIGN_NOT_OWNED';
  end if;

  if p.status='completed' then
    return jsonb_build_object(
      'ok',true,
      'idempotent',true,
      'status','completed',
      'ad_id',p.campaign_id,
      'activated',c.status='active'
    );
  end if;

  if p_result_code<>0 then
    update public.testagram_ad_payments
    set status='failed',
        result_code=p_result_code,
        result_description=p_result_description,
        callback_data=coalesce(p_callback_data,'{}'::jsonb),
        provider_response=coalesce(p_provider_response,'{}'::jsonb)
    where id=p.id and status='pending';

    if p.wallet_transaction_id is not null then
      update public.wallet_transactions
      set status='failed',
          provider_status=coalesce(p_result_description,'M-Pesa payment failed'),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mpesa_result_code',p_result_code)
      where id=p.wallet_transaction_id and status='pending';
    end if;

    if p.mpesa_payment_id is not null then
      update public.mpesa_payments
      set status='failed',
          result_code=p_result_code,
          result_description=p_result_description,
          callback_data=coalesce(p_callback_data,'{}'::jsonb),
          updated_at=now()
      where id=p.mpesa_payment_id and status='pending';
    end if;

    return jsonb_build_object('ok',true,'status','failed','ad_id',p.campaign_id,'result_code',p_result_code);
  end if;

  if p_receipt_number is null or length(trim(p_receipt_number))=0 then
    raise exception 'MPESA_RECEIPT_REQUIRED';
  end if;

  if p_amount_kes is null or round(p_amount_kes::numeric,2)<>round(p.amount_kes::numeric,2) then
    raise exception 'MPESA_AMOUNT_MISMATCH';
  end if;

  if upper(c.currency)<>'KES' then
    raise exception 'AD_BILLING_CURRENCY_MUST_BE_KES';
  end if;

  spend_amount:=round(coalesce(c.lifetime_budget_micros,0)/1000000.0,2);

  if spend_amount<=0 or round(spend_amount,2)<>round(p.amount_kes,2) then
    raise exception 'CAMPAIGN_PAYMENT_AMOUNT_MISMATCH';
  end if;

  if p.wallet_id is null or p.wallet_transaction_id is null then
    raise exception 'PAYMENT_WALLET_LINK_MISSING';
  end if;

  select * into wt
  from public.wallet_transactions
  where id=p.wallet_transaction_id
  for update;

  if not found or wt.user_id is distinct from p.user_id or wt.wallet_id is distinct from p.wallet_id then
    raise exception 'WALLET_TRANSACTION_OWNER_MISMATCH';
  end if;

  select * into w
  from public.wallets
  where id=p.wallet_id and user_id=p.user_id
  for update;

  if not found or w.status<>'active' or w.spending_enabled=false then
    raise exception 'WALLET_UNAVAILABLE';
  end if;

  if wt.status='completed' then
    raise exception 'AD_PAYMENT_ALREADY_SETTLED';
  end if;

  if wt.status<>'pending' then
    raise exception 'WALLET_TRANSACTION_NOT_PENDING';
  end if;

  before_balance:=coalesce(w.balance,0);
  after_credit:=before_balance+spend_amount;

  update public.wallets
  set balance=after_credit,updated_at=now()
  where id=w.id;

  update public.wallet_transactions
  set status='completed',
      balance_before=before_balance,
      balance_after=after_credit,
      provider_status='COMPLETED',
      provider_capture_id=coalesce(p_receipt_number,provider_capture_id),
      completed_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mpesa_checkout_request_id',p_checkout_request_id,
        'mpesa_receipt_number',p_receipt_number,
        'ad_id',p.campaign_id,
        'accounting_purpose','ad_funding_clearing'
      )
  where id=wt.id;

  insert into public.wallet_transactions(
    wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,
    balance_before,balance_after,provider,provider_reference,provider_status,
    description,metadata,payment_method,completed_at
  ) values(
    w.id,p.user_id,'ad_spend','ad_spend',spend_amount,round(spend_amount*100),
    'KES','debit','completed',after_credit,after_credit-spend_amount,'testagram',
    p.campaign_id::text,'COMPLETED','Testagram ad campaign funding',
    jsonb_build_object('campaign_id',p.campaign_id,'mpesa_checkout_request_id',p_checkout_request_id),
    'mpesa',now()
  );

  update public.wallets
  set balance=after_credit-spend_amount,updated_at=now()
  where id=w.id;

  update public.testagram_ad_campaigns
  set payment_status='funded',
      payment_reference=p_receipt_number,
      funded_micros=lifetime_budget_micros,
      status=case
        when moderation_status='rejected' then 'rejected'
        when moderation_status='pending' then 'pending_review'
        when ends_at is not null and ends_at<now() then 'completed'
        else 'active'
      end,
      updated_at=now()
  where id=p.campaign_id
    and advertiser_id=c.advertiser_id
    and payment_status<>'funded';

  if not found and c.payment_status<>'funded' then
    raise exception 'CAMPAIGN_ACTIVATION_UPDATE_FAILED';
  end if;

  update public.testagram_ad_payments
  set status='completed',
      result_code=0,
      result_description=p_result_description,
      mpesa_receipt_number=p_receipt_number,
      callback_data=coalesce(p_callback_data,'{}'::jsonb),
      provider_response=coalesce(p_provider_response,'{}'::jsonb)
  where id=p.id;

  if p.mpesa_payment_id is not null then
    update public.mpesa_payments
    set status='completed',
        result_code=0,
        receipt_number=coalesce(p_receipt_number,receipt_number),
        result_description=p_result_description,
        callback_data=coalesce(p_callback_data,'{}'::jsonb),
        completed_at=now(),
        updated_at=now()
    where id=p.mpesa_payment_id and status='pending';
  end if;

  return jsonb_build_object(
    'ok',true,
    'idempotent',false,
    'status','completed',
    'ad_id',p.campaign_id,
    'activated',(select status='active' from public.testagram_ad_campaigns where id=p.campaign_id),
    'receipt_number',p_receipt_number
  );
end;
$function$;

revoke all on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_testagram_ad_mpesa_payment(text,integer,text,text,numeric,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;
grant execute on function public.finalize_testagram_ad_mpesa_payment(text,integer,text,text,numeric,jsonb,jsonb) to service_role;
