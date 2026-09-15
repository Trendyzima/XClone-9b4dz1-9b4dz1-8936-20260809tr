create or replace function public.p2p_wallet_transfer(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from uuid := auth.uid();
  v_from_wallet public.wallets;
  v_to_wallet public.wallets;
  v_from_balance numeric;
  v_to_balance numeric;
  v_ref text := 'P2P-' || upper(replace(gen_random_uuid()::text, '-', ''));
  v_amount numeric := round(p_amount, 2);
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 240), '');
begin
  if v_from is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_from_user_id is null or p_from_user_id <> v_from then raise exception 'FORBIDDEN'; end if;
  if p_to_user_id is null or p_to_user_id = v_from then raise exception 'INVALID_RECIPIENT'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  if v_from < p_to_user_id then
    select * into v_from_wallet from public.wallets where user_id = v_from for update;
    select * into v_to_wallet from public.wallets where user_id = p_to_user_id for update;
  else
    select * into v_to_wallet from public.wallets where user_id = p_to_user_id for update;
    select * into v_from_wallet from public.wallets where user_id = v_from for update;
  end if;

  if v_from_wallet.id is null then raise exception 'SENDER_WALLET_NOT_FOUND'; end if;
  if v_to_wallet.id is null then raise exception 'RECIPIENT_WALLET_NOT_FOUND'; end if;
  if v_from_wallet.status <> 'active' or not v_from_wallet.spending_enabled then raise exception 'SENDER_WALLET_DISABLED'; end if;
  if v_to_wallet.status <> 'active' then raise exception 'RECIPIENT_WALLET_DISABLED'; end if;
  if v_from_wallet.currency <> v_to_wallet.currency then raise exception 'CURRENCY_MISMATCH'; end if;
  if v_from_wallet.balance < v_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  v_from_balance := v_from_wallet.balance;
  v_to_balance := v_to_wallet.balance;

  update public.wallets set balance = balance - v_amount, updated_at = now() where id = v_from_wallet.id;
  update public.wallets set balance = balance + v_amount, updated_at = now() where id = v_to_wallet.id;

  insert into public.wallet_transactions(
    wallet_id, user_id, type, status, amount, currency,
    balance_before, balance_after, provider, provider_reference,
    description, metadata, payment_method, reference, direction, kind
  ) values (
    v_from_wallet.id, v_from, 'transfer', 'completed', v_amount, v_from_wallet.currency,
    v_from_balance, v_from_balance - v_amount, 'internal', v_ref,
    coalesce(v_note, 'Wallet transfer to another Testagram user'),
    jsonb_build_object('transfer_ref', v_ref, 'recipient_user_id', p_to_user_id, 'note', v_note),
    'internal', v_ref, 'out', 'p2p_transfer'
  );

  insert into public.wallet_transactions(
    wallet_id, user_id, type, status, amount, currency,
    balance_before, balance_after, provider, provider_reference,
    description, metadata, payment_method, reference, direction, kind
  ) values (
    v_to_wallet.id, p_to_user_id, 'transfer', 'completed', v_amount, v_to_wallet.currency,
    v_to_balance, v_to_balance + v_amount, 'internal', v_ref,
    coalesce(v_note, 'Wallet transfer received from another Testagram user'),
    jsonb_build_object('transfer_ref', v_ref, 'sender_user_id', v_from, 'note', v_note),
    'internal', v_ref, 'in', 'p2p_transfer'
  );

  return jsonb_build_object(
    'success', true,
    'reference', v_ref,
    'amount', v_amount,
    'currency', v_from_wallet.currency,
    'recipient_user_id', p_to_user_id
  );
end;
$$;

revoke execute on function public.p2p_wallet_transfer(uuid, uuid, numeric, text) from public;
revoke execute on function public.p2p_wallet_transfer(uuid, uuid, numeric, text) from anon;
grant execute on function public.p2p_wallet_transfer(uuid, uuid, numeric, text) to authenticated;
