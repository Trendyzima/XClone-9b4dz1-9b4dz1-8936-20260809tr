-- Reconcile the live Testagram-owned ad settlement contract.
-- The original live settlement migration is present in the remote migration
-- history but is not reproducible from this repository branch. This migration
-- reasserts the canonical function and its wallet transaction contract.

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_kind_check
  CHECK (kind = ANY (ARRAY[
    'topup'::text,
    'tip'::text,
    'subscription'::text,
    'purchase'::text,
    'refund'::text,
    'adjustment'::text,
    'ad_spend'::text
  ]));

CREATE OR REPLACE FUNCTION public.finalize_testagram_ad_mpesa_payment(
  p_checkout_request_id text,
  p_result_code integer,
  p_receipt_number text,
  p_result_description text,
  p_amount_kes numeric,
  p_callback_data jsonb DEFAULT '{}'::jsonb,
  p_provider_response jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  p public.testagram_ad_payments%rowtype;
  c public.testagram_ad_campaigns%rowtype;
  a public.testagram_advertisers%rowtype;
  w public.wallets%rowtype;
  wt public.wallet_transactions%rowtype;
  before_balance numeric;
  after_credit numeric;
  spend_amount numeric;
begin
  if nullif(btrim(p_checkout_request_id),'') is null then
    return jsonb_build_object('ok',false,'reason','checkout_request_id_required');
  end if;

  select * into p
  from public.testagram_ad_payments
  where checkout_request_id=p_checkout_request_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','payment_not_found');
  end if;

  select * into c
  from public.testagram_ad_campaigns
  where id=p.campaign_id
  for update;

  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  select * into a
  from public.testagram_advertisers
  where id=c.advertiser_id
  for share;

  if not found or a.owner_user_id is distinct from p.user_id then
    raise exception 'CAMPAIGN_NOT_OWNED';
  end if;

  if p.status='completed' then
    return jsonb_build_object(
      'ok',true,
      'idempotent',true,
      'status','completed',
      'ad_id',p.campaign_id,
      'activated',c.status='active'
    );
  end if;

  if p_result_code<>0 then
    update public.testagram_ad_payments
    set status='failed',
        result_code=p_result_code,
        result_description=p_result_description,
        callback_data=coalesce(p_callback_data,'{}'::jsonb),
        provider_response=coalesce(p_provider_response,'{}'::jsonb)
    where id=p.id and status='pending';

    if p.wallet_transaction_id is not null then
      update public.wallet_transactions
      set status='failed',
          provider_status=coalesce(p_result_description,'M-Pesa payment failed'),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mpesa_result_code',p_result_code)
      where id=p.wallet_transaction_id and status='pending';
    end if;

    if p.mpesa_payment_id is not null then
      update public.mpesa_payments
      set status='failed',
          result_code=p_result_code,
          result_description=p_result_description,
          callback_data=coalesce(p_callback_data,'{}'::jsonb),
          updated_at=now()
      where id=p.mpesa_payment_id and status='pending';
    end if;

    return jsonb_build_object('ok',true,'status','failed','ad_id',p.campaign_id,'result_code',p_result_code);
  end if;

  if p_receipt_number is null or length(trim(p_receipt_number))=0 then
    raise exception 'MPESA_RECEIPT_REQUIRED';
  end if;

  if p_amount_kes is null or round(p_amount_kes::numeric,2)<>round(p.amount_kes::numeric,2) then
    raise exception 'MPESA_AMOUNT_MISMATCH';
  end if;

  if upper(c.currency)<>'KES' then
    raise exception 'AD_BILLING_CURRENCY_MUST_BE_KES';
  end if;

  spend_amount:=round(coalesce(c.lifetime_budget_micros,0)/1000000.0,2);

  if spend_amount<=0 or round(spend_amount,2)<>round(p.amount_kes,2) then
    raise exception 'CAMPAIGN_PAYMENT_AMOUNT_MISMATCH';
  end if;

  if p.wallet_id is null or p.wallet_transaction_id is null then
    raise exception 'PAYMENT_WALLET_LINK_MISSING';
  end if;

  select * into wt
  from public.wallet_transactions
  where id=p.wallet_transaction_id
  for update;

  if not found or wt.user_id is distinct from p.user_id or wt.wallet_id is distinct from p.wallet_id then
    raise exception 'WALLET_TRANSACTION_OWNER_MISMATCH';
  end if;

  select * into w
  from public.wallets
  where id=p.wallet_id and user_id=p.user_id
  for update;

  if not found or w.status<>'active' or w.spending_enabled=false then
    raise exception 'WALLET_UNAVAILABLE';
  end if;

  if wt.status='completed' then
    raise exception 'AD_PAYMENT_ALREADY_SETTLED';
  end if;

  if wt.status<>'pending' then
    raise exception 'WALLET_TRANSACTION_NOT_PENDING';
  end if;

  before_balance:=coalesce(w.balance,0);
  after_credit:=before_balance+spend_amount;

  update public.wallets
  set balance=after_credit,updated_at=now()
  where id=w.id;

  update public.wallet_transactions
  set status='completed',
      balance_before=before_balance,
      balance_after=after_credit,
      provider_status='COMPLETED',
      provider_capture_id=coalesce(p_receipt_number,provider_capture_id),
      completed_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mpesa_checkout_request_id',p_checkout_request_id,
        'mpesa_receipt_number',p_receipt_number,
        'ad_id',p.campaign_id,
        'accounting_purpose','ad_funding_clearing'
      )
  where id=wt.id;

  insert into public.wallet_transactions(
    wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,
    balance_before,balance_after,provider,provider_reference,provider_status,
    description,metadata,payment_method,completed_at
  ) values(
    w.id,p.user_id,'ad_spend','ad_spend',spend_amount,round(spend_amount*100),
    'KES','debit','completed',after_credit,after_credit-spend_amount,'testagram',
    p.campaign_id::text,'COMPLETED','Testagram ad campaign funding',
    jsonb_build_object('campaign_id',p.campaign_id,'mpesa_checkout_request_id',p_checkout_request_id),
    'mpesa',now()
  );

  update public.wallets
  set balance=after_credit-spend_amount,updated_at=now()
  where id=w.id;

  update public.testagram_ad_campaigns
  set payment_status='funded',
      payment_reference=p_receipt_number,
      funded_micros=lifetime_budget_micros,
      status=case
        when starts_at<=now() and (ends_at is null or ends_at>=now()) then 'active'
        else 'pending_payment'
      end,
      updated_at=now()
  where id=p.campaign_id
    and advertiser_id=c.advertiser_id
    and payment_status<>'funded';

  if not found and c.payment_status<>'funded' then
    raise exception 'CAMPAIGN_ACTIVATION_UPDATE_FAILED';
  end if;

  update public.testagram_ad_payments
  set status='completed',
      result_code=0,
      result_description=p_result_description,
      mpesa_receipt_number=p_receipt_number,
      callback_data=coalesce(p_callback_data,'{}'::jsonb),
      provider_response=coalesce(p_provider_response,'{}'::jsonb)
  where id=p.id;

  if p.mpesa_payment_id is not null then
    update public.mpesa_payments
    set status='completed',
        result_code=0,
        receipt_number=coalesce(p_receipt_number,receipt_number),
        result_description=p_result_description,
        callback_data=coalesce(p_callback_data,'{}'::jsonb),
        completed_at=now(),
        updated_at=now()
    where id=p.mpesa_payment_id and status='pending';
  end if;

  return jsonb_build_object(
    'ok',true,
    'idempotent',false,
    'status','completed',
    'ad_id',p.campaign_id,
    'activated',true,
    'receipt_number',p_receipt_number
  );
end;
$function$;
