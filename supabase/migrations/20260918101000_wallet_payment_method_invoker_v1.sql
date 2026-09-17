drop policy if exists wallets_own_update on public.wallets;
create policy wallets_own_update on public.wallets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on public.wallets from authenticated,anon;
grant update (mpesa_phone,paypal_email) on public.wallets to authenticated;

create or replace function public.update_wallet_payment_methods(p_mpesa_phone text default null,p_paypal_email text default null)
returns public.wallets
language plpgsql
security invoker
set search_path=''
as $$
declare w public.wallets; v_email text; v_phone text;
begin
 if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
 v_email:=nullif(lower(btrim(coalesce(p_paypal_email,''))),'');
 v_phone:=nullif(btrim(coalesce(p_mpesa_phone,'')),'');
 if v_email is not null and (length(v_email)>254 or v_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$') then raise exception 'INVALID_PAYPAL_EMAIL'; end if;
 if v_phone is not null and not exists (select 1 from public.wallet_phone_identities i where i.user_id=(select auth.uid()) and i.wallet_id=(select w0.id from public.wallets w0 where w0.user_id=(select auth.uid()) limit 1) and i.phone_e164=v_phone and i.verified_at is not null) then raise exception 'MPESA_PHONE_NOT_VERIFIED'; end if;
 update public.wallets set mpesa_phone=v_phone,paypal_email=v_email,updated_at=pg_catalog.now() where user_id=(select auth.uid()) returning * into w;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 return w;
end;
$$;
revoke execute on function public.update_wallet_payment_methods(text,text) from public,anon;
grant execute on function public.update_wallet_payment_methods(text,text) to authenticated;
