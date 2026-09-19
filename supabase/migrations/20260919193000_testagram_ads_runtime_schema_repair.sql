-- Repair live Testagram Ads runtime schema.
-- This migration is intentionally self-contained so production is reproducible even when
-- older wallet/M-Pesa migrations are absent. Payment settlement is layered separately.
create table if not exists public.testagram_advertisers (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, status text not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.testagram_ad_accounts (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, currency text not null default 'KES', status text not null default 'active', timezone text not null default 'Africa/Nairobi', created_at timestamptz not null default now()
);
create table if not exists public.testagram_ad_account_members (
 ad_account_id uuid not null references public.testagram_ad_accounts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, role text not null default 'owner',
 primary key(ad_account_id,user_id)
);
create table if not exists public.testagram_ad_slots (
 id text primary key, code text unique not null, kind text not null default 'feed', floor_cpm_micros bigint not null default 0,
 enabled boolean not null default true, width integer, height integer, created_at timestamptz not null default now()
);
create table if not exists public.testagram_ad_campaigns (
 id uuid primary key default gen_random_uuid(), advertiser_id uuid not null references public.testagram_advertisers(id) on delete cascade,
 ad_account_id uuid references public.testagram_ad_accounts(id) on delete set null, created_by uuid references auth.users(id) on delete set null,
 name text not null, objective text not null default 'traffic', status text not null default 'draft',
 payment_status text not null default 'unpaid', currency text not null default 'KES',
 lifetime_budget_micros bigint not null check(lifetime_budget_micros>=0), funded_micros bigint not null default 0,
 daily_budget_micros bigint, bid_cpm_micros bigint not null default 50000, priority integer not null default 50,
 starts_at timestamptz not null default now(), ends_at timestamptz, targeting jsonb not null default '{}',
 payment_reference text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.testagram_ad_sets (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
 name text not null, status text not null default 'active', optimization_goal text not null default 'traffic',
 billing_event text not null default 'impression', bid_strategy text not null default 'lowest_cost',
 bid_amount_minor bigint not null default 0, lifetime_budget_minor bigint not null default 0,
 start_at timestamptz not null default now(), end_at timestamptz, placement_mode text not null default 'automatic', created_at timestamptz not null default now()
);
create table if not exists public.testagram_ad_creatives (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
 format text not null default 'display', headline text not null, body text, cta text not null default 'Learn more',
 asset_url text, click_through_url text not null, weight integer not null default 1, enabled boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.testagram_ads (
 id uuid primary key default gen_random_uuid(), ad_set_id uuid not null references public.testagram_ad_sets(id) on delete cascade,
 creative_id uuid not null references public.testagram_ad_creatives(id) on delete cascade, name text not null,
 status text not null default 'active', destination_type text not null default 'url', destination_url text not null,
 call_to_action text not null default 'Learn more', tracking_params jsonb not null default '{}',
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.testagram_ad_daily_spend (
 campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade, spend_date date not null,
 spend_micros bigint not null default 0, impressions bigint not null default 0, clicks bigint not null default 0,
 primary key(campaign_id,spend_date)
);
create table if not exists public.testagram_ad_impressions (
 id uuid primary key default gen_random_uuid(), request_id text not null, impression_id text unique not null,
 slot_code text not null references public.testagram_ad_slots(code), campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
 creative_id uuid not null references public.testagram_ad_creatives(id) on delete cascade, user_id uuid references auth.users(id) on delete set null,
 billable_micros bigint not null default 0, clicked boolean not null default false, consent jsonb not null default '{}',
 metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create unique index if not exists testagram_ad_impressions_request_id_key on public.testagram_ad_impressions(request_id);
create table if not exists public.testagram_ad_events (
 id uuid primary key default gen_random_uuid(), impression_id text not null references public.testagram_ad_impressions(impression_id) on delete cascade,
 event_type text not null, user_id uuid references auth.users(id) on delete set null, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
 unique(impression_id,event_type)
);
create table if not exists public.testagram_ad_frequency (
 user_id uuid not null references auth.users(id) on delete cascade, campaign_id uuid not null references public.testagram_ad_campaigns(id) on delete cascade,
 window_start timestamptz not null, impressions integer not null default 0, primary key(user_id,campaign_id,window_start)
);
alter table public.testagram_advertisers enable row level security;
alter table public.testagram_ad_accounts enable row level security;
alter table public.testagram_ad_account_members enable row level security;
alter table public.testagram_ad_slots enable row level security;
alter table public.testagram_ad_campaigns enable row level security;
alter table public.testagram_ad_sets enable row level security;
alter table public.testagram_ad_creatives enable row level security;
alter table public.testagram_ads enable row level security;
alter table public.testagram_ad_daily_spend enable row level security;
alter table public.testagram_ad_impressions enable row level security;
alter table public.testagram_ad_events enable row level security;
alter table public.testagram_ad_frequency enable row level security;
drop policy if exists testagram_ads_advertiser_select on public.testagram_advertisers;
create policy testagram_ads_advertiser_select on public.testagram_advertisers for select to authenticated using(owner_user_id=auth.uid());
drop policy if exists testagram_ads_account_select on public.testagram_ad_accounts;
create policy testagram_ads_account_select on public.testagram_ad_accounts for select to authenticated using(owner_user_id=auth.uid());
drop policy if exists testagram_ads_member_select on public.testagram_ad_account_members;
create policy testagram_ads_member_select on public.testagram_ad_account_members for select to authenticated using(user_id=auth.uid());
drop policy if exists testagram_ads_slots_select on public.testagram_ad_slots;
create policy testagram_ads_slots_select on public.testagram_ad_slots for select to authenticated using(enabled=true);
drop policy if exists testagram_ads_campaign_select on public.testagram_ad_campaigns;
create policy testagram_ads_campaign_select on public.testagram_ad_campaigns for select to authenticated using(exists(select 1 from public.testagram_advertisers a where a.id=advertiser_id and a.owner_user_id=auth.uid()));
drop policy if exists testagram_ads_set_select on public.testagram_ad_sets;
create policy testagram_ads_set_select on public.testagram_ad_sets for select to authenticated using(exists(select 1 from public.testagram_ad_campaigns c join public.testagram_advertisers a on a.id=c.advertiser_id where c.id=campaign_id and a.owner_user_id=auth.uid()));
drop policy if exists testagram_ads_creative_select on public.testagram_ad_creatives;
create policy testagram_ads_creative_select on public.testagram_ad_creatives for select to authenticated using(exists(select 1 from public.testagram_ad_campaigns c join public.testagram_advertisers a on a.id=c.advertiser_id where c.id=campaign_id and a.owner_user_id=auth.uid()));
drop policy if exists testagram_ads_ad_select on public.testagram_ads;
create policy testagram_ads_ad_select on public.testagram_ads for select to authenticated using(exists(select 1 from public.testagram_ad_sets s join public.testagram_ad_campaigns c on c.id=s.campaign_id join public.testagram_advertisers a on a.id=c.advertiser_id where s.id=ad_set_id and a.owner_user_id=auth.uid()));
drop policy if exists testagram_ads_impression_select on public.testagram_ad_impressions;
create policy testagram_ads_impression_select on public.testagram_ad_impressions for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.testagram_ad_campaigns c join public.testagram_advertisers a on a.id=c.advertiser_id where c.id=campaign_id and a.owner_user_id=auth.uid()));
drop policy if exists testagram_ads_event_select on public.testagram_ad_events;
create policy testagram_ads_event_select on public.testagram_ad_events for select to authenticated using(user_id=auth.uid());
insert into public.testagram_ad_slots(id,code,kind,floor_cpm_micros,width,height) values
('testagram-feed-top','feed-top','feed',50000,728,90),('testagram-feed-inline','feed-inline','feed',50000,728,90),
('testagram-profile','profile','profile',50000,728,90),('testagram-explore','explore','explore',50000,728,90),('testagram-story','story','story',50000,1080,1920)
on conflict(code) do update set enabled=true;
create or replace function public.testagram_claim_ad_impression(p_request_id text,p_impression_id text,p_slot_code text,p_campaign_id uuid,p_creative_id uuid,p_user_id uuid,p_billable_micros bigint,p_consent jsonb default '{}',p_metadata jsonb default '{}') returns boolean language plpgsql security definer set search_path=public as $$
declare v_lifetime bigint; v_daily bigint; v_spend bigint; v_floor bigint;
begin
 select floor_cpm_micros into v_floor from public.testagram_ad_slots where code=p_slot_code and enabled=true;
 if not found or p_billable_micros<v_floor or p_billable_micros<=0 then return false; end if;
 select lifetime_budget_micros,daily_budget_micros into v_lifetime,v_daily from public.testagram_ad_campaigns where id=p_campaign_id and status='active' and payment_status='funded' and starts_at<=now() and (ends_at is null or ends_at>now()) for update;
 if not found then return false; end if;
 select coalesce(sum(spend_micros),0) into v_spend from public.testagram_ad_daily_spend where campaign_id=p_campaign_id;
 if v_spend+p_billable_micros>v_lifetime then return false; end if;
 if v_daily is not null then select coalesce(spend_micros,0) into v_spend from public.testagram_ad_daily_spend where campaign_id=p_campaign_id and spend_date=current_date for update; if v_spend+p_billable_micros>v_daily then return false; end if; end if;
 insert into public.testagram_ad_daily_spend(campaign_id,spend_date,spend_micros,impressions) values(p_campaign_id,current_date,p_billable_micros,1) on conflict(campaign_id,spend_date) do update set spend_micros=public.testagram_ad_daily_spend.spend_micros+excluded.spend_micros,impressions=public.testagram_ad_daily_spend.impressions+1;
 insert into public.testagram_ad_impressions(request_id,impression_id,slot_code,campaign_id,creative_id,user_id,billable_micros,consent,metadata) values(p_request_id,p_impression_id,p_slot_code,p_campaign_id,p_creative_id,p_user_id,p_billable_micros,p_consent,p_metadata);
 return true;
end; $$;
revoke all on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.testagram_claim_ad_impression(text,text,text,uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;
