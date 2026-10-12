-- Require a server-verified wallet PIN in the same database transaction
-- as a P2P transfer. Client-side PIN prompts are not an authorization boundary.
create or replace function public.p2p_wallet_transfer_verified(
  p_to_user_id uuid,
  p_amount numeric,
  p_note text,
  p_pin text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_pin_result jsonb;
  v_transfer_result jsonb;
  v_key text := nullif(left(btrim(coalesce(p_idempotency_key, '')), 200), '');
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  if p_to_user_id is null or p_to_user_id = v_user then
    raise exception 'INVALID_RECIPIENT';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('success', false, 'code', 'INVALID_PIN_FORMAT');
  end if;

  -- This RPC persists failed-attempt counters and applies the server lockout.
  v_pin_result := public.verify_wallet_pin(p_pin);
  if coalesce((v_pin_result ->> 'success')::boolean, false) is not true then
    return v_pin_result;
  end if;

  -- The canonical transfer function performs authenticated sender checks,
  -- wallet status/currency/balance checks, row locking, ledger projections,
  -- and idempotency-key replay protection.
  v_transfer_result := public.p2p_wallet_transfer(
    v_user, p_to_user_id, p_amount, p_note, v_key
  );
  return v_transfer_result;
end;
$function$;

revoke all on function public.p2p_wallet_transfer_verified(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.p2p_wallet_transfer_verified(uuid, numeric, text, text, text) to authenticated;
