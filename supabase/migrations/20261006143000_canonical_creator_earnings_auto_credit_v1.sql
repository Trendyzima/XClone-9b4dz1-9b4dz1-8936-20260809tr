-- Canonical creator earnings auto-credit v1.
-- Creator monetization credits the canonical USER wallet account through the
-- double-entry ledger. No legacy add_to_wallet path is used.

create or replace function public.credit_creator_earning_to_wallet(
  p_creator_id uuid,
  p_amount numeric,
  p_currency text default 'KES',
  p_reference_type text default 'creator_earning',
  p_reference_id uuid default null,
  p_idempotency_key text default null,
  p_description text default 'Creator earnings'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_currency text:=upper(coalesce(p_currency,'KES'));
  v_amount numeric:=round(coalesce(p_amount,0),2);
  v_creator_account uuid;
  v_platform_account uuid;
  v_tx uuid;
begin
  if current_user <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_creator_id is null or v_amount <= 0 then raise exception 'INVALID_CREATOR_EARNING'; end if;
  if v_currency <> 'KES' then raise exception 'UNSUPPORTED_EARNING_CURRENCY'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  perform private.ensure_user_financial_accounts(p_creator_id,v_currency);

  select id into v_creator_account
  from public.wallet_accounts
  where account_type='USER' and user_id=p_creator_id and currency=v_currency and status='ACTIVE'
  for update;

  select id into v_platform_account
  from public.wallet_accounts
  where account_type='PLATFORM' and currency=v_currency and status='ACTIVE'
  limit 1
  for update;

  if v_creator_account is null or v_platform_account is null then raise exception 'CANONICAL_WALLET_ACCOUNT_MISSING'; end if;

  v_tx:=private.post_wallet_ledger(
    'CREATOR_EARNING',
    coalesce(p_reference_type,'creator_earning'),
    p_reference_id,
    'creator-earning:'||trim(p_idempotency_key),
    coalesce(p_description,'Creator earnings'),
    jsonb_build_array(
      jsonb_build_object('account_id',v_platform_account,'direction','DEBIT','amount_minor',round(v_amount*100)::bigint),
      jsonb_build_object('account_id',v_creator_account,'direction','CREDIT','amount_minor',round(v_amount*100)::bigint)
    ),
    jsonb_build_object('creator_user_id',p_creator_id,'currency',v_currency,'source','creator_monetization')
  );

  return jsonb_build_object('ok',true,'creator_id',p_creator_id,'amount',v_amount,'currency',v_currency,'wallet_account_id',v_creator_account,'ledger_transaction_id',v_tx);
end;
$$;

revoke all on function public.credit_creator_earning_to_wallet(uuid,numeric,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.credit_creator_earning_to_wallet(uuid,numeric,text,text,uuid,text,text) to service_role;

comment on function public.credit_creator_earning_to_wallet(uuid,numeric,text,text,uuid,text,text)
is 'Canonical creator monetization credit. Credits the creator USER wallet account through the double-entry ledger and is idempotent by source key.';