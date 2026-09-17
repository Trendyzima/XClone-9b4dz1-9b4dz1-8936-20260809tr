-- Canonical creator payout provider boundary.
-- This migration does NOT touch legacy wallets, creator_payouts, wallet_transactions,
-- ZenAd, or provider settlement functions. It only adds an idempotent state transition
-- for monetization_payouts before an external provider request.

create or replace function public.begin_monetization_payout_processing(
  p_payout_id uuid
)
returns public.monetization_payouts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  p public.monetization_payouts;
begin
  if (select current_user) <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select * into p
  from public.monetization_payouts
  where id = p_payout_id
  for update;

  if not found then
    raise exception 'payout not found';
  end if;

  if p.status in ('paid', 'failed') then
    return p;
  end if;

  if p.status not in ('requested', 'processing') then
    raise exception 'payout is not processable';
  end if;

  update public.monetization_payouts
  set status = 'processing'
  where id = p.id
  returning * into p;

  return p;
end;
$function$;

revoke all on function public.begin_monetization_payout_processing(uuid) from public;
grant execute on function public.begin_monetization_payout_processing(uuid) to service_role;
