create or replace function public.update_wallet_payment_methods(p_mpesa_phone text default null, p_paypal_email text default null)
returns public.wallets
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets;
  v_email text;
  v_phone text;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  v_email := nullif(lower(btrim(coalesce(p_paypal_email, ''))), '');
  v_phone := nullif(btrim(coalesce(p_mpesa_phone, '')), '');
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$') then raise exception 'INVALID_PAYPAL_EMAIL'; end if;
  update public.wallets set mpesa_phone=v_phone,paypal_email=v_email,updated_at=pg_catalog.now() where user_id=(select auth.uid()) returning * into w;
  if not found then insert into public.wallets(user_id,balance,currency,mpesa_phone,paypal_email) values((select auth.uid()),0,'USD',v_phone,v_email) returning * into w; end if;
  return w;
end;
$$;
revoke execute on function public.update_wallet_payment_methods(text,text) from public,anon;
grant execute on function public.update_wallet_payment_methods(text,text) to authenticated;

create or replace function public.add_to_wallet(p_user_id uuid,p_amount numeric)
returns boolean
language plpgsql
security invoker
set search_path=''
as $$
declare v_tx public.wallet_transactions;
begin
  if (select auth.uid()) is null or (select auth.uid())<>p_user_id then raise exception 'FORBIDDEN'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
  select * into v_tx from public.wallet_transactions where user_id=p_user_id and type='deposit' and status='completed' and abs(coalesce(amount,0)-round(p_amount,2))<0.005 and provider='mpesa' order by completed_at desc nulls last,created_at desc limit 1;
  if not found then raise exception 'DEPOSIT_NOT_SETTLED'; end if;
  return true;
end;
$$;
revoke execute on function public.add_to_wallet(uuid,numeric) from public,anon;
grant execute on function public.add_to_wallet(uuid,numeric) to authenticated;

create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id,created_at desc);
create index if not exists wallet_transactions_provider_order_idx on public.wallet_transactions(provider,provider_order_id) where provider_order_id is not null;
