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
  greatest(pt.balance - coalesce(pt.lifetime_creator_share, 0), 0) as informational_platform_remainder,
  now() as observed_at
from public.platform_treasury pt;

comment on view public.platform_wallet is
  'Read-only platform treasury projection. Not an independent money authority and not a writable wallet.';

-- Explicitly expose treasury custody state without introducing another balance writer.
create or replace view public.platform_treasury_control as
select
  pt.currency,
  pt.balance as custody_balance,
  pt.lifetime_revenue,
  pt.lifetime_creator_share,
  now() as observed_at
from public.platform_treasury pt;

comment on view public.platform_treasury_control is
  'Read-only control-plane projection of platform_treasury. Financial mutations remain in canonical settlement RPCs.';

-- Restrict direct access to service/admin paths. No INSERT/UPDATE/DELETE grants are introduced.
revoke all on public.platform_wallet from anon, authenticated;
revoke all on public.platform_treasury_control from anon, authenticated;

grant select on public.platform_wallet to service_role;
grant select on public.platform_treasury_control to service_role;

-- Admin read policy remains governed by the existing platform treasury policy.
-- No payout or settlement path is changed in this migration.
