-- Platform Treasury Control v1
-- Additive control/projection layer only.
-- Does NOT replace existing monetary writers or create financial_* tables.
-- Existing platform_treasury remains the current settlement balance authority.

create or replace view public.platform_wallet as
select
  pt.currency,
  pt.balance as treasury_balance,
  pt.lifetime_revenue,
  pt.lifetime_creator_share,
  pt.lifetime_refunds,
  pt.updated_at,
  now() as observed_at
from public.platform_treasury pt;

comment on view public.platform_wallet is
  'Read-only platform treasury projection. Not an independent money authority and not a writable wallet.';

create or replace view public.platform_treasury_control as
select
  pt.currency,
  pt.balance as treasury_balance,
  pt.lifetime_revenue,
  pt.lifetime_creator_share,
  pt.lifetime_refunds,
  coalesce(ma.creator_available, 0) as creator_payable_available,
  coalesce(ma.creator_pending, 0) as creator_payable_pending,
  coalesce(mp.payout_reserved, 0) as creator_payout_reserved,
  pt.updated_at,
  now() as observed_at
from public.platform_treasury pt
left join (
  select
    currency,
    sum(available_cents)::numeric / 100 as creator_available,
    sum(pending_cents)::numeric / 100 as creator_pending
  from public.monetization_accounts
  group by currency
) ma on ma.currency = pt.currency
left join (
  select
    currency,
    sum(amount_cents)::numeric / 100 as payout_reserved
  from public.monetization_payouts
  where status in ('requested','processing')
  group by currency
) mp on mp.currency = pt.currency;

comment on view public.platform_treasury_control is
  'Read-only treasury control projection. Shows existing treasury balance and creator payable/payout state without becoming a second money authority.';

revoke all on public.platform_wallet from anon, authenticated;
revoke all on public.platform_treasury_control from anon, authenticated;

grant select on public.platform_wallet to service_role;
grant select on public.platform_treasury_control to service_role;

-- No payout, provider settlement, wallet, or ZenAd writer is changed by this migration.
-- The next migration must reconcile writers before making this treasury the universal settlement boundary.
