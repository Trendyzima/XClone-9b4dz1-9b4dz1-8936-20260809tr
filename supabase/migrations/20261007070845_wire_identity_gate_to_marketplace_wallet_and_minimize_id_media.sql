-- Enforce approved identity verification before sensitive wallet and marketplace mutations.
create or replace function private.require_verified_identity(p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare v_status text;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select p.identity_verification_status into v_status from public.profiles p where p.id=p_user_id;
  if coalesce(v_status,'not_required') <> 'approved' then raise exception 'IDENTITY_VERIFICATION_REQUIRED'; end if;
end
$function$;
revoke all on function private.require_verified_identity(uuid) from public, anon, authenticated;

do $$
declare r record; d text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (
      (p.proname='claim_marketplace_delivery' and pg_get_function_identity_arguments(p.oid)='p_delivery_id uuid') or
      (p.proname='confirm_marketplace_delivery' and pg_get_function_identity_arguments(p.oid)='p_delivery_id uuid') or
      (p.proname='create_marketplace_delivery' and pg_get_function_identity_arguments(p.oid)='p_order_id uuid') or
      (p.proname='register_marketplace_delivery_agent' and pg_get_function_identity_arguments(p.oid)='p_display_name text, p_phone text') or
      (p.proname='withdraw_marketplace_earnings' and pg_get_function_identity_arguments(p.oid)='') or
      (p.proname='p2p_wallet_transfer' and pg_get_function_identity_arguments(p.oid) in ('p_from_user_id uuid, p_to_user_id uuid, p_amount numeric, p_note text','p_from_user_id uuid, p_to_user_id uuid, p_amount numeric, p_note text, p_idempotency_key text')) or
      (p.proname='wallet_pay_creator' and pg_get_function_identity_arguments(p.oid)='p_to_user_id uuid, p_amount numeric, p_creator_share_bps integer, p_reference_type text, p_reference_id uuid, p_idempotency_key text') or
      (p.proname='wallet_pay_ride' and pg_get_function_identity_arguments(p.oid)='p_ride_id uuid, p_amount numeric, p_currency text, p_idempotency_key text') or
      (p.proname='save_to_wallet_savings' and pg_get_function_identity_arguments(p.oid)='p_amount numeric, p_idempotency_key text') or
      (p.proname='withdraw_from_wallet_savings' and pg_get_function_identity_arguments(p.oid)='p_amount numeric, p_idempotency_key text') or
      (p.proname='place_marketplace_order' and pg_get_function_identity_arguments(p.oid)='p_product_id uuid, p_quantity integer, p_idempotency_key text, p_delivery_mode text, p_delivery_address text, p_delivery_note text, p_reservation_key text')
    )
  loop
    d:=pg_get_functiondef(r.oid);
    d:=regexp_replace(d,E'\nbegin\n',E'\nbegin\n  perform private.require_verified_identity(auth.uid());\n',1,1);
    execute d;
  end loop;
end $$;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='refresh_marketplace_seller_trust' and pg_get_function_identity_arguments(p.oid)='p_seller_id uuid' limit 1;
  d:=replace(d,'select coalesce(verified,false) into verified_flag from public.profiles where id=p_seller_id;',
    'select (coalesce(verified,false) and identity_verification_status=''approved'') into verified_flag from public.profiles where id=p_seller_id;');
  execute d;
end $$;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_identity_verification'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_national_id text, p_front_object_path text, p_back_object_path text, p_request_id text, p_source_ip inet, p_user_agent text' limit 1;
  d:=replace(d,'user_id,id_number_hmac,id_number_last4,email_snapshot,front_object_path,back_object_path,status,','user_id,id_number_hmac,id_number_last4,email_snapshot,status,');
  d:=replace(d,'values(p_user_id,id_hmac,right(normalized_id,4),v_email,p_front_object_path,p_back_object_path,''submitted'',','values(p_user_id,id_hmac,right(normalized_id,4),v_email,''submitted'',');
  d:=replace(d,'front_object_path=excluded.front_object_path,back_object_path=excluded.back_object_path,status=''submitted'',','status=''submitted'',');
  execute d;
end $$;

alter table public.identity_verifications drop column if exists front_object_path, drop column if exists back_object_path;
