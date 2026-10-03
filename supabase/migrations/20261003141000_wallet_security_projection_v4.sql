-- Do not expose wallet hashes or biometric public material to browser roles.
drop function if exists public.get_my_wallet();

create function public.get_my_wallet()
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  w public.wallets;
  u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into w from public.wallets where user_id=u::text limit 1;
  if not found then
    insert into public.wallets(user_id,balance,currency,status,spending_enabled,withdrawals_enabled,preferred_currency)
    values(u::text,0,'USD','active',true,true,'USD')
    returning * into w;
  end if;
  return jsonb_build_object(
    'id',w.id,'user_id',w.user_id,'balance',w.balance,'currency',w.currency,
    'created_at',w.created_at,'updated_at',w.updated_at,
    'total_deposited',w.total_deposited,'total_withdrawn',w.total_withdrawn,
    'mpesa_phone',w.mpesa_phone,'paypal_email',w.paypal_email,'status',w.status,
    'spending_enabled',w.spending_enabled,'withdrawals_enabled',w.withdrawals_enabled,
    'spend_limit_enabled',w.spend_limit_enabled,'daily_spend_limit',w.daily_spend_limit,
    'preferred_currency',w.preferred_currency,'savings_balance',w.savings_balance
  );
end;
$function$;

revoke all on function public.get_my_wallet() from public;
grant execute on function public.get_my_wallet() to authenticated;

drop policy if exists wallet_security_owner_select on public.wallet_security;

create or replace function public.get_my_wallet_security()
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  u uuid:=auth.uid();
  s public.wallet_security%rowtype;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into s from public.wallet_security where user_id=u;
  return jsonb_build_object(
    'pin_set', s.pin_hash is not null,
    'biometric_enabled', coalesce(s.biometric_enabled,false),
    'biometric_credential_id', s.biometric_credential_id
  );
end;
$function$;

revoke all on function public.get_my_wallet_security() from public;
grant execute on function public.get_my_wallet_security() to authenticated;
