-- M-Pesa cash-out is a sensitive financial operation and requires approved identity.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reserve_mpesa_withdrawal'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_wallet_id uuid, p_amount numeric, p_currency text, p_phone text, p_amount_kes numeric, p_client_reference text'
  limit 1;
  if d is null then raise exception 'MPESA_WITHDRAW_TARGET_MISSING'; end if;
  d:=regexp_replace(d,E'\nbegin\n',E'\nbegin\n  perform private.require_verified_identity(p_user_id);\n',1,1);
  execute d;
end $$;
