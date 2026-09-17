create table if not exists public.ad_mpesa_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.user_ads(id) on delete cascade,
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

create unique index if not exists ad_mpesa_payments_checkout_uidx
  on public.ad_mpesa_payments (checkout_request_id)
  where checkout_request_id is not null;

create unique index if not exists ad_mpesa_payments_receipt_uidx
  on public.ad_mpesa_payments (mpesa_receipt_number)
  where mpesa_receipt_number is not null;

create index if not exists ad_mpesa_payments_user_ad_idx
  on public.ad_mpesa_payments (user_id, ad_id, created_at desc);

create index if not exists ad_mpesa_payments_status_idx
  on public.ad_mpesa_payments (status, updated_at desc);

create or replace function public.set_ad_mpesa_payment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ad_mpesa_payment_updated_at on public.ad_mpesa_payments;
create trigger trg_ad_mpesa_payment_updated_at
before update on public.ad_mpesa_payments
for each row execute function public.set_ad_mpesa_payment_updated_at();

alter table public.ad_mpesa_payments enable row level security;

drop policy if exists "ad mpesa payments owner select" on public.ad_mpesa_payments;
create policy "ad mpesa payments owner select"
  on public.ad_mpesa_payments
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.finalize_ad_mpesa_payment(
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
set search_path = public
as $$
declare
  payment_row public.ad_mpesa_payments%rowtype;
  ad_row public.user_ads%rowtype;
begin
  if p_checkout_request_id is null or length(trim(p_checkout_request_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_checkout_request_id');
  end if;

  select * into payment_row
  from public.ad_mpesa_payments
  where checkout_request_id = p_checkout_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  select * into ad_row
  from public.user_ads
  where id = payment_row.ad_id
    and user_id = payment_row.user_id
  for update;

  if not found then
    raise exception 'AD_PAYMENT_OWNER_MISMATCH';
  end if;

  if payment_row.status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'status', 'completed',
      'ad_id', payment_row.ad_id
    );
  end if;

  if p_result_code = 0 then
    if p_receipt_number is null or length(trim(p_receipt_number)) = 0 then
      raise exception 'MPESA_RECEIPT_REQUIRED';
    end if;

    if p_amount_kes is null
       or round(p_amount_kes::numeric, 2) <> round(payment_row.amount_kes::numeric, 2) then
      raise exception 'MPESA_AMOUNT_MISMATCH';
    end if;

    update public.ad_mpesa_payments
    set status = 'completed',
        result_code = p_result_code,
        result_description = p_result_description,
        mpesa_receipt_number = p_receipt_number,
        callback_data = coalesce(p_callback_data, '{}'::jsonb),
        provider_response = coalesce(p_provider_response, '{}'::jsonb)
    where id = payment_row.id
      and status = 'pending';

    update public.user_ads
    set payment_status = 'paid',
        payment_reference = p_checkout_request_id,
        status = 'active'
    where id = payment_row.ad_id
      and user_id = payment_row.user_id
      and coalesce(payment_status, 'pending') <> 'paid';

    if not found and coalesce(ad_row.payment_status, 'pending') <> 'paid' then
      raise exception 'AD_ACTIVATION_UPDATE_FAILED';
    end if;

    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'status', 'completed',
      'ad_id', payment_row.ad_id,
      'activated', true
    );
  end if;

  update public.ad_mpesa_payments
  set status = 'failed',
      result_code = p_result_code,
      result_description = p_result_description,
      callback_data = coalesce(p_callback_data, '{}'::jsonb),
      provider_response = coalesce(p_provider_response, '{}'::jsonb)
  where id = payment_row.id
    and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'status', 'failed',
    'ad_id', payment_row.ad_id
  );
end;
$$;

grant execute on function public.finalize_ad_mpesa_payment(text, integer, text, text, numeric, jsonb, jsonb) to service_role;
