create table if not exists public.zenad_mpesa_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.zenad_campaigns(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  mpesa_payment_id uuid references public.mpesa_payments(id) on delete set null,
  amount_kes numeric(12,2) not null check (amount_kes >= 10),
  phone text not null,
  merchant_request_id text,
  checkout_request_id text,
  mpesa_receipt_number text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  result_code integer,
  result_description text,
  callback_data jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists zenad_mpesa_payments_checkout_uidx on public.zenad_mpesa_payments(checkout_request_id) where checkout_request_id is not null;
create unique index if not exists zenad_mpesa_payments_receipt_uidx on public.zenad_mpesa_payments(mpesa_receipt_number) where mpesa_receipt_number is not null;
create index if not exists zenad_mpesa_payments_owner_idx on public.zenad_mpesa_payments(user_id,ad_id,created_at desc);
create index if not exists zenad_mpesa_payments_status_idx on public.zenad_mpesa_payments(status,updated_at desc);

create or replace function public.set_zenad_mpesa_payment_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;

drop trigger if exists trg_zenad_mpesa_payment_updated_at on public.zenad_mpesa_payments;
create trigger trg_zenad_mpesa_payment_updated_at before update on public.zenad_mpesa_payments for each row execute function public.set_zenad_mpesa_payment_updated_at();

alter table public.zenad_mpesa_payments enable row level security;
drop policy if exists "zenad mpesa payments owner select" on public.zenad_mpesa_payments;
create policy "zenad mpesa payments owner select" on public.zenad_mpesa_payments for select to authenticated using (user_id=auth.uid());

create or replace function public.finalize_zenad_mpesa_ad_payment(
  p_checkout_request_id text,
  p_result_code integer,
  p_receipt_number text,
  p_result_description text,
  p_amount_kes numeric,
  p_callback_data jsonb default '{}'::jsonb,
  p_provider_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.zenad_mpesa_payments%rowtype;
  c public.zenad_campaigns%rowtype;
  a public.zenad_advertisers%rowtype;
  w public.wallets%rowtype;
  wt public.wallet_transactions%rowtype;
  before_balance numeric;
  after_credit numeric;
  spend_amount numeric;
begin
  if nullif(btrim(p_checkout_request_id),'') is null then return jsonb_build_object('ok',false,'reason','checkout_request_id_required'); end if;
  select * into p from public.zenad_mpesa_payments where checkout_request_id=p_checkout_request_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','payment_not_found'); end if;
  select * into c from public.zenad_campaigns where id=p.ad_id for update;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  select * into a from public.zenad_advertisers where id=c.advertiser_id for share;
  if not found or a.owner_user_id is distinct from p.user_id then raise exception 'CAMPAIGN_NOT_OWNED'; end if;
  if p.status='completed' then return jsonb_build_object('ok',true,'idempotent',true,'status','completed','ad_id',p.ad_id,'activated',c.status='active'); end if;
  if p_result_code <> 0 then
    update public.zenad_mpesa_payments set status='failed',result_code=p_result_code,result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),provider_response=coalesce(p_provider_response,'{}'::jsonb) where id=p.id and status='pending';
    if p.wallet_transaction_id is not null then update public.wallet_transactions set status='failed',provider_status=coalesce(p_result_description,'M-Pesa payment failed'),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mpesa_result_code',p_result_code) where id=p.wallet_transaction_id and status='pending'; end if;
    if p.mpesa_payment_id is not null then update public.mpesa_payments set status='failed',result_code=p_result_code,result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),updated_at=now() where id=p.mpesa_payment_id and status='pending'; end if;
    return jsonb_build_object('ok',true,'status','failed','ad_id',p.ad_id,'result_code',p_result_code);
  end if;
  if p_receipt_number is null or length(trim(p_receipt_number))=0 then raise exception 'MPESA_RECEIPT_REQUIRED'; end if;
  if p_amount_kes is null or round(p_amount_kes::numeric,2)<>round(p.amount_kes::numeric,2) then raise exception 'MPESA_AMOUNT_MISMATCH'; end if;
  if upper(c.currency)<>'KES' then raise exception 'AD_BILLING_CURRENCY_MUST_BE_KES'; end if;
  spend_amount:=round(coalesce(c.lifetime_budget_micros,0)/1000000.0,2);
  if spend_amount<=0 or round(spend_amount,2)<>round(p.amount_kes,2) then raise exception 'CAMPAIGN_PAYMENT_AMOUNT_MISMATCH'; end if;
  if p.wallet_id is null or p.wallet_transaction_id is null then raise exception 'PAYMENT_WALLET_LINK_MISSING'; end if;
  select * into wt from public.wallet_transactions where id=p.wallet_transaction_id for update;
  if not found or wt.user_id is distinct from p.user_id or wt.wallet_id is distinct from p.wallet_id then raise exception 'WALLET_TRANSACTION_OWNER_MISMATCH'; end if;
  select * into w from public.wallets where id=p.wallet_id and user_id=p.user_id for update;
  if not found or w.status<>'active' or w.spending_enabled=false then raise exception 'WALLET_UNAVAILABLE'; end if;
  if wt.status='completed' then raise exception 'AD_PAYMENT_ALREADY_SETTLED'; end if;
  if wt.status<>'pending' then raise exception 'WALLET_TRANSACTION_NOT_PENDING'; end if;
  before_balance:=coalesce(w.balance,0);
  after_credit:=before_balance+spend_amount;
  update public.wallets set balance=after_credit,total_deposited=coalesce(total_deposited,0)+spend_amount,updated_at=now() where id=w.id;
  update public.wallet_transactions set status='completed',balance_before=before_balance,balance_after=after_credit,provider_status='COMPLETED',provider_capture_id=coalesce(p_receipt_number,provider_capture_id),completed_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mpesa_checkout_request_id',p_checkout_request_id,'mpesa_receipt_number',p_receipt_number,'ad_id',p.ad_id) where id=wt.id;
  insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,provider_reference,provider_status,description,metadata,payment_method,completed_at)
  values(w.id,p.user_id,'ad_spend','ad_spend',spend_amount,round(spend_amount*100),'KES','debit','completed',after_credit,after_credit-spend_amount,'testagram',p.ad_id::text,'COMPLETED','Testagram ad campaign funding',jsonb_build_object('campaign_id',p.ad_id,'mpesa_checkout_request_id',p_checkout_request_id),'mpesa',now()) returning * into wt;
  update public.wallets set balance=after_credit-spend_amount,updated_at=now() where id=w.id;
  update public.zenad_campaigns set payment_status='funded',payment_reference=p_receipt_number,funded_micros=lifetime_budget_micros,status='active',updated_at=now() where id=p.ad_id and advertiser_id=c.advertiser_id and payment_status<>'funded';
  if not found and c.payment_status<>'funded' then raise exception 'CAMPAIGN_ACTIVATION_UPDATE_FAILED'; end if;
  update public.zenad_mpesa_payments set status='completed',result_code=0,result_description=p_result_description,mpesa_receipt_number=p_receipt_number,callback_data=coalesce(p_callback_data,'{}'::jsonb),provider_response=coalesce(p_provider_response,'{}'::jsonb) where id=p.id;
  if p.mpesa_payment_id is not null then update public.mpesa_payments set status='completed',result_code=0,receipt_number=coalesce(p_receipt_number,receipt_number),result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'::jsonb),completed_at=now(),updated_at=now() where id=p.mpesa_payment_id and status='pending'; end if;
  return jsonb_build_object('ok',true,'idempotent',false,'status','completed','ad_id',p.ad_id,'activated',true,'receipt_number',p_receipt_number);
end;
$$;

revoke all on function public.finalize_zenad_mpesa_ad_payment(text,integer,text,text,numeric,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_zenad_mpesa_ad_payment(text,integer,text,text,numeric,jsonb,jsonb) to service_role;
