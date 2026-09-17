-- Testagram-owned Ads domain.
-- ZenAd is intentionally NOT the source of truth. It remains a serving dependency.
-- Browser clients never write these tables directly; authenticated product APIs do.

create table if not exists public.testagram_advertisers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','paused','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testagram_ad_slots (
  id text primary key,
  code text not null unique,
  kind text not null default 'feed',
  floor_cpm_micros bigint not null default 0 check (floor_cpm_micros >= 0),
  enabled boolean not null default true,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

create table if not exists public.testagram_ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.testagram_advertisers(id) on delete cascade,
  name text not null,
  objective text not null default 'traffic',
  status text not null default 'draft' check (status in ('draft','pending_payment','active','paused','completed','rejected','archived')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','funded','failed','refunded')),
  currency text not null default 'KES' check (currency = 'KES'),
  lifetime_budget_micros bigint not null check (lifetime_budget_micros >= 0),
  funded_micros bigint not null default 0 check (funded_micros >= 0),
  daily_budget_micros bigint,
  bid_cpm_micros bigint not null default 50000 check (bid_cpm_micros >= 0),
  priority integer not null default 50,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  targeting jsonb not null default '{}'::jsonb,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.testagram_ad_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
  format text not null default 'display' check (format in ('display','story','video')),
  headline text not null,
  body text,
  cta text not null default 'Learn more',
  asset_url text,
  click_through_url text not null,
  weight integer not null default 1 check (weight > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testagram_ad_daily_spend (
  campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
  spend_date date not null,
  spend_micros bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  primary key (campaign_id, spend_date)
);

create table if not exists public.testagram_ad_impressions (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  impression_id text not null unique,
  slot_code text not null references public.testagram_ad_slots(code),
  campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
  creative_id uuid not null references public.testagram_ad_creatives(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  billable_micros bigint not null default 0,
  clicked boolean not null default false,
  consent jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.testagram_ad_events (
  id uuid primary key default gen_random_uuid(),
  impression_id text not null references public.testagram_ad_impressions(impression_id) on delete cascade,
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (impression_id, event_type)
);

create table if not exists public.testagram_ad_frequency (
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
  window_start timestamptz not null,
  impressions integer not null default 0,
  primary key (user_id, campaign_id, window_start)
);

create table if not exists public.testagram_ad_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  mpesa_payment_id uuid references public.mpesa_payments(id) on delete set null,
  amount_kes numeric(12,2) not null check (amount_kes >= 10),
  phone text not null,
  merchant_request_id text,
  checkout_request_id text,
  mpesa_receipt_number text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  result_code integer,
  result_description text,
  callback_data jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists testagram_ad_payments_checkout_uidx on public.testagram_ad_payments(checkout_request_id) where checkout_request_id is not null;
create unique index if not exists testagram_ad_payments_receipt_uidx on public.testagram_ad_payments(mpesa_receipt_number) where mpesa_receipt_number is not null;
create index if not exists testagram_ad_campaigns_owner_idx on public.testagram_advertisers(owner_user_id, created_at desc);
create index if not exists testagram_ad_campaigns_status_idx on public.testagram_ad_campaigns(status, starts_at, ends_at);
create index if not exists testagram_ad_impressions_campaign_idx on public.testagram_ad_impressions(campaign_id, created_at desc);
create index if not exists testagram_ad_impressions_user_idx on public.testagram_ad_impressions(user_id, created_at desc);
create index if not exists testagram_ad_events_impression_idx on public.testagram_ad_events(impression_id, created_at desc);
create index if not exists testagram_ad_payments_owner_idx on public.testagram_ad_payments(user_id, campaign_id, created_at desc);

create or replace function public.set_testagram_ad_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_testagram_advertisers_updated_at on public.testagram_advertisers;
create trigger trg_testagram_advertisers_updated_at before update on public.testagram_advertisers for each row execute function public.set_testagram_ad_updated_at();
drop trigger if exists trg_testagram_ad_campaigns_updated_at on public.testagram_ad_campaigns;
create trigger trg_testagram_ad_campaigns_updated_at before update on public.testagram_ad_campaigns for each row execute function public.set_testagram_ad_updated_at();
drop trigger if exists trg_testagram_ad_creatives_updated_at on public.testagram_ad_creatives;
create trigger trg_testagram_ad_creatives_updated_at before update on public.testagram_ad_creatives for each row execute function public.set_testagram_ad_updated_at();
drop trigger if exists trg_testagram_ad_payments_updated_at on public.testagram_ad_payments;
create trigger trg_testagram_ad_payments_updated_at before update on public.testagram_ad_payments for each row execute function public.set_testagram_ad_updated_at();

alter table public.testagram_advertisers enable row level security;
alter table public.testagram_ad_slots enable row level security;
alter table public.testagram_ad_campaigns enable row level security;
alter table public.testagram_ad_creatives enable row level security;
alter table public.testagram_ad_daily_spend enable row level security;
alter table public.testagram_ad_impressions enable row level security;
alter table public.testagram_ad_events enable row level security;
alter table public.testagram_ad_frequency enable row level security;
alter table public.testagram_ad_payments enable row level security;

drop policy if exists testagram_ads_advertiser_select on public.testagram_advertisers;
create policy testagram_ads_advertiser_select on public.testagram_advertisers for select to authenticated using (owner_user_id = auth.uid());
drop policy if exists testagram_ads_slots_select on public.testagram_ad_slots;
create policy testagram_ads_slots_select on public.testagram_ad_slots for select to authenticated using (enabled = true);
drop policy if exists testagram_ads_campaign_select on public.testagram_ad_campaigns;
create policy testagram_ads_campaign_select on public.testagram_ad_campaigns for select to authenticated using (exists (select 1 from public.testagram_advertisers a where a.id = advertiser_id and a.owner_user_id = auth.uid()));
drop policy if exists testagram_ads_creative_select on public.testagram_ad_creatives;
create policy testagram_ads_creative_select on public.testagram_ad_creatives for select to authenticated using (exists (select 1 from public.testagram_ad_campaigns c join public.testagram_advertisers a on a.id = c.advertiser_id where c.id = campaign_id and a.owner_user_id = auth.uid()));
drop policy if exists testagram_ads_spend_select on public.testagram_ad_daily_spend;
create policy testagram_ads_spend_select on public.testagram_ad_daily_spend for select to authenticated using (exists (select 1 from public.testagram_ad_campaigns c join public.testagram_advertisers a on a.id = c.advertiser_id where c.id = campaign_id and a.owner_user_id = auth.uid()));
drop policy if exists testagram_ads_impression_select on public.testagram_ad_impressions;
create policy testagram_ads_impression_select on public.testagram_ad_impressions for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.testagram_ad_campaigns c join public.testagram_advertisers a on a.id = c.advertiser_id where c.id = campaign_id and a.owner_user_id = auth.uid()));
drop policy if exists testagram_ads_event_select on public.testagram_ad_events;
create policy testagram_ads_event_select on public.testagram_ad_events for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.testagram_ad_impressions i join public.testagram_ad_campaigns c on c.id = i.campaign_id join public.testagram_advertisers a on a.id = c.advertiser_id where i.impression_id = impression_id and a.owner_user_id = auth.uid()));
drop policy if exists testagram_ads_payment_select on public.testagram_ad_payments;
create policy testagram_ads_payment_select on public.testagram_ad_payments for select to authenticated using (user_id = auth.uid());

-- Platform placements are Testagram-owned configuration. ZenAd only consumes them.
insert into public.testagram_ad_slots(id,code,kind,floor_cpm_micros,width,height) values
 ('testagram-feed-top','feed-top','feed',50000,728,90),
 ('testagram-feed-inline','feed-inline','feed',50000,728,90),
 ('testagram-profile','profile','profile',50000,728,90),
 ('testagram-explore','explore','explore',50000,728,90),
 ('testagram-story','story','story',50000,1080,1920)
on conflict(code) do update set enabled=true;

create or replace function public.testagram_claim_ad_impression(
  p_request_id text,
  p_impression_id text,
  p_slot_code text,
  p_campaign_id uuid,
  p_creative_id uuid,
  p_user_id uuid,
  p_billable_micros bigint,
  p_consent jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  v_daily date := current_date;
  v_spend bigint := 0;
  v_budget bigint;
  v_window timestamptz := date_trunc('day', now());
  v_count integer := 0;
  v_cap integer := 0;
  v_floor bigint;
begin
  select floor_cpm_micros into v_floor from public.testagram_ad_slots where code=p_slot_code and enabled=true;
  if not found then return false; end if;
  select lifetime_budget_micros, daily_budget_micros, targeting->'frequencyCap'->>'maxImpressions'
    into v_budget, v_budget, v_cap from public.testagram_ad_campaigns where id=p_campaign_id and status='active' and payment_status='funded' for update;
  if not found then return false; end if;
  select lifetime_budget_micros, daily_budget_micros, coalesce((targeting->'frequencyCap'->>'maxImpressions')::integer,0)
    into v_budget, v_budget, v_cap from public.testagram_ad_campaigns where id=p_campaign_id;
  if p_billable_micros < v_floor then return false; end if;
  if v_budget is not null then
    select coalesce(sum(spend_micros),0) into v_spend from public.testagram_ad_daily_spend where campaign_id=p_campaign_id;
    if v_spend + p_billable_micros > v_budget then return false; end if;
  end if;
  if p_user_id is not null and v_cap > 0 then
    select impressions into v_count from public.testagram_ad_frequency where user_id=p_user_id and campaign_id=p_campaign_id and window_start=v_window for update;
    if coalesce(v_count,0) >= v_cap then return false; end if;
  end if;
  insert into public.testagram_ad_daily_spend(campaign_id,spend_date,spend_micros,impressions)
  values(p_campaign_id,v_daily,p_billable_micros,1)
  on conflict(campaign_id,spend_date) do update set spend_micros=public.testagram_ad_daily_spend.spend_micros+excluded.spend_micros, impressions=public.testagram_ad_daily_spend.impressions+1;
  insert into public.testagram_ad_impressions(request_id,impression_id,slot_code,campaign_id,creative_id,user_id,billable_micros,consent,metadata)
  values(p_request_id,p_impression_id,p_slot_code,p_campaign_id,p_creative_id,p_user_id,p_billable_micros,coalesce(p_consent,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb));
  if p_user_id is not null and v_cap > 0 then
    insert into public.testagram_ad_frequency(user_id,campaign_id,window_start,impressions) values(p_user_id,p_campaign_id,v_window,1)
    on conflict(user_id,campaign_id,window_start) do update set impressions=public.testagram_ad_frequency.impressions+1;
  end if;
  return true;
end; $$;

-- Correct the budget variables without changing the public contract above.
create or replace function public.testagram_claim_ad_impression(
  p_request_id text,p_impression_id text,p_slot_code text,p_campaign_id uuid,p_creative_id uuid,p_user_id uuid,p_billable_micros bigint,p_consent jsonb default '{}'::jsonb,p_metadata jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_daily date:=current_date; v_spend bigint:=0; v_lifetime bigint; v_daily_budget bigint; v_window timestamptz:=date_trunc('day',now()); v_count integer:=0; v_cap integer:=0; v_floor bigint;
begin
 select floor_cpm_micros into v_floor from public.testagram_ad_slots where code=p_slot_code and enabled=true;
 if not found then return false; end if;
 select lifetime_budget_micros,daily_budget_micros,coalesce((targeting->'frequencyCap'->>'maxImpressions')::integer,0) into v_lifetime,v_daily_budget,v_cap from public.testagram_ad_campaigns where id=p_campaign_id and status='active' and payment_status='funded' and starts_at<=now() and (ends_at is null or ends_at>=now()) for update;
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

create or replace function public.testagram_record_ad_click(p_impression_id text) returns boolean language plpgsql security definer set search_path=public as $$
declare v_campaign uuid; v_user uuid; v_changed boolean;
begin
 select campaign_id,user_id into v_campaign,v_user from public.testagram_ad_impressions where impression_id=p_impression_id for update;
 if not found then return false; end if;
 update public.testagram_ad_impressions set clicked=true where impression_id=p_impression_id and clicked=false returning true into v_changed;
 if coalesce(v_changed,false) then
   insert into public.testagram_ad_events(impression_id,event_type,user_id) values(p_impression_id,'click',v_user) on conflict(impression_id,event_type) do nothing;
   update public.testagram_ad_daily_spend set clicks=clicks+1 where campaign_id=v_campaign and spend_date=current_date;
   return true;
 end if;
 return false;
end; $$;

create or replace function public.finalize_testagram_ad_mpesa_payment(
  p_checkout_request_id text,p_result_code integer,p_receipt_number text,p_result_description text,p_amount_kes numeric,p_callback_data jsonb default '{}'::jsonb,p_provider_response jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.testagram_ad_payments%rowtype; c public.testagram_ad_campaigns%rowtype; a public.testagram_advertisers%rowtype; w public.wallets%rowtype; wt public.wallet_transactions%rowtype; before_balance numeric; after_credit numeric; spend_amount numeric;
begin
 if nullif(btrim(p_checkout_request_id),'') is null then return jsonb_build_object('ok',false,'reason','checkout_request_id_required'); end if;
 select * into p from public.testagram_ad_payments where checkout_request_id=p_checkout_request_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','payment_not_found'); end if;
 select * into c from public.testagram_ad_campaigns where id=p.campaign_id for update;
 if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
 select * into a from public.testagram_advertisers where id=c.advertiser_id for share;
 if not found or a.owner_user_id is distinct from p.user_id then raise exception 'CAMPAIGN_NOT_OWNED'; end if;
 if p.status='completed' then return jsonb_build_object('ok',true,'idempotent',true,'status','completed','ad_id',p.campaign_id,'activated',c.status='active'); end if;
 if p_result_code<>0 then
   update public.testagram_ad_payments set status='failed',result_code=p_result_code,result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),provider_response=coalesce(p_provider_response,'{}'::jsonb) where id=p.id and status='pending';
   update public.testagram_ad_campaigns set payment_status='failed',status='draft',updated_at=now() where id=p.campaign_id and payment_status<>'funded';
   if p.wallet_transaction_id is not null then update public.wallet_transactions set status='failed',provider_status=coalesce(p_result_description,'M-Pesa payment failed'),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mpesa_result_code',p_result_code) where id=p.wallet_transaction_id and status='pending'; end if;
   if p.mpesa_payment_id is not null then update public.mpesa_payments set status='failed',result_code=p_result_code,result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),updated_at=now() where id=p.mpesa_payment_id and status='pending'; end if;
   return jsonb_build_object('ok',true,'status','failed','ad_id',p.campaign_id,'result_code',p_result_code);
 end if;
 if p_receipt_number is null or length(trim(p_receipt_number))=0 then raise exception 'MPESA_RECEIPT_REQUIRED'; end if;
 if p_amount_kes is null or round(p_amount_kes::numeric,2)<>round(p.amount_kes::numeric,2) then raise exception 'MPESA_AMOUNT_MISMATCH'; end if;
 spend_amount:=round(coalesce(c.lifetime_budget_micros,0)/1000000.0,2);
 if spend_amount<=0 or round(spend_amount,2)<>round(p.amount_kes,2) then raise exception 'CAMPAIGN_PAYMENT_AMOUNT_MISMATCH'; end if;
 if p.wallet_id is null or p.wallet_transaction_id is null then raise exception 'PAYMENT_WALLET_LINK_MISSING'; end if;
 select * into wt from public.wallet_transactions where id=p.wallet_transaction_id for update;
 if not found or wt.user_id is distinct from p.user_id or wt.wallet_id is distinct from p.wallet_id then raise exception 'WALLET_TRANSACTION_OWNER_MISMATCH'; end if;
 select * into w from public.wallets where id=p.wallet_id and user_id=p.user_id for update;
 if not found or w.status<>'active' or w.spending_enabled=false then raise exception 'WALLET_UNAVAILABLE'; end if;
 if wt.status='completed' then raise exception 'AD_PAYMENT_ALREADY_SETTLED'; end if;
 if wt.status<>'pending' then raise exception 'WALLET_TRANSACTION_NOT_PENDING'; end if;
 before_balance:=coalesce(w.balance,0); after_credit:=before_balance+spend_amount;
 update public.wallets set balance=after_credit,total_deposited=coalesce(total_deposited,0)+spend_amount,updated_at=now() where id=w.id;
 update public.wallet_transactions set status='completed',balance_before=before_balance,balance_after=after_credit,provider_status='COMPLETED',provider_capture_id=coalesce(p_receipt_number,provider_capture_id),completed_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mpesa_checkout_request_id',p_checkout_request_id,'mpesa_receipt_number',p_receipt_number,'ad_id',p.campaign_id) where id=wt.id;
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,provider_reference,provider_status,description,metadata,payment_method,completed_at) values(w.id,p.user_id,'ad_spend','ad_spend',spend_amount,round(spend_amount*100),'KES','debit','completed',after_credit,after_credit-spend_amount,'testagram',p.campaign_id::text,'COMPLETED','Testagram ad campaign funding',jsonb_build_object('campaign_id',p.campaign_id,'mpesa_checkout_request_id',p_checkout_request_id),'mpesa',now()) returning * into wt;
 update public.wallets set balance=after_credit-spend_amount,updated_at=now() where id=w.id;
 update public.testagram_ad_campaigns set payment_status='funded',payment_reference=p_receipt_number,funded_micros=lifetime_budget_micros,status=case when starts_at<=now() and (ends_at is null or ends_at>=now()) then 'active' else 'pending_payment' end,updated_at=now() where id=p.campaign_id and advertiser_id=c.advertiser_id and payment_status<>'funded';
 update public.testagram_ad_payments set status='completed',result_code=0,result_description=p_result_description,mpesa_receipt_number=p_receipt_number,callback_data=coalesce(p_callback_data,'{}'::jsonb),provider_response=coalesce(p_provider_response,'{}'::jsonb) where id=p.id;
 if p.mpesa_payment_id is not null then update public.mpesa_payments set status='completed',result_code=0,receipt_number=coalesce(p_receipt_number,receipt_number),result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),completed_at=now(),updated_at=now() where id=p.mpesa_payment_id and status='pending'; end if;
 return jsonb_build_object('ok',true,'idempotent',false,'status','completed','ad_id',p.campaign_id,'activated',true,'receipt_number',p_receipt_number);
end; $$;

revoke all on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.testagram_record_ad_click(text) from public,anon,authenticated;
revoke all on function public.finalize_testagram_ad_mpesa_payment(text,integer,text,text,numeric,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_testagram_ad_mpesa_payment(text,integer,text,text,numeric,jsonb,jsonb) to service_role;
