-- Fix canonical wallet provisioning for authenticated users.
-- The wallet table intentionally has no client INSERT policy; provisioning must
-- happen inside a tightly scoped SECURITY DEFINER RPC.
create or replace function public.get_my_wallet()
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets;
  u uuid := auth.uid();
begin
  if u is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into w
    from public.wallets
   where user_id = u::text
   limit 1;

  if not found then
    insert into public.wallets(
      user_id,
      balance,
      currency,
      status,
      spending_enabled,
      withdrawals_enabled,
      preferred_currency
    )
    values (
      u::text,
      0,
      'USD',
      'active',
      true,
      true,
      'USD'
    )
    returning * into w;
  end if;

  return w;
end;
$$;

revoke execute on function public.get_my_wallet() from public, anon;
grant execute on function public.get_my_wallet() to authenticated;

-- Provision the canonical wallet row for existing authenticated accounts
-- without copying or rewriting legacy balances.
insert into public.wallets(
  user_id,
  balance,
  currency,
  status,
  spending_enabled,
  withdrawals_enabled,
  preferred_currency
)
select
  u.id::text,
  0,
  'USD',
  'active',
  true,
  true,
  'USD'
from auth.users u
on conflict (user_id) do nothing;
