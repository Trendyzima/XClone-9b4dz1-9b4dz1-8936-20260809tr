-- Canonical wallet + monetization bridge repair.
-- Reconciles the legacy wallets table with the current Wallet UI, M-Pesa,
-- savings, transfers and Testagram Ads settlement contracts.
-- No existing balances are rewritten by this migration.

alter table public.wallets add column if not exists total_deposited numeric(20,2) not null default 0;
alter table public.wallets add column if not exists total_withdrawn numeric(20,2) not null default 0;
alter table public.wallets add column if not exists mpesa_phone text;
alter table public.wallets add column if not exists paypal_email text;
alter table public.wallets add column if not exists status text not null default 'active';
alter table public.wallets add column if not exists spending_enabled boolean not null default true;
alter table public.wallets add column if not exists withdrawals_enabled boolean not null default true;
alter table public.wallets add column if not exists spend_limit_enabled boolean not null default false;
alter table public.wallets add column if not exists daily_spend_limit numeric(20,2);
alter table public.wallets add column if not exists wallet_pin_hash text;
alter table public.wallets add column if not exists biometric_credential_id text;
alter table public.wallets add column if not exists preferred_currency text default 'USD';
alter table public.wallets add column if not exists savings_balance numeric(20,2) not null default 0;

create table if not exists public.wallet_transactions (
 id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id) on delete cascade,
 user_id text not null, kind text not null default 'wallet', type text not null,
 amount numeric(20,2) not null check(amount>=0), amount_cents bigint,
 currency text not null default 'USD', direction text not null check(direction in ('credit','debit','in','out')),
 status text not null default 'pending', balance_before numeric(20,2), balance_after numeric(20,2),
 provider text, provider_order_id text, provider_reference text, provider_status text, provider_capture_id text,
 description text, metadata jsonb not null default '{}', payment_method text, reference text,
 completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id,created_at desc);
create index if not exists wallet_transactions_provider_order_idx on public.wallet_transactions(provider,provider_order_id) where provider_order_id is not null;
create unique index if not exists wallet_transactions_provider_order_uidx on public.wallet_transactions(provider,provider_order_id) where provider_order_id is not null;

create table if not exists public.wallet_phone_identities (
 id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, phone_e164 text not null,
 verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(wallet_id), unique(user_id)
);
alter table public.wallet_phone_identities enable row level security;
drop policy if exists wallet_phone_identity_own on public.wallet_phone_identities;
create policy wallet_phone_identity_own on public.wallet_phone_identities for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);

create table if not exists public.mpesa_payments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 wallet_id uuid references public.wallets(id) on delete set null, wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
 merchant_request_id text, checkout_request_id text unique, amount_kes numeric(12,2) not null,
 wallet_amount numeric(20,2), wallet_currency text default 'USD', phone text not null, status text not null default 'pending',
 result_code integer, result_description text, receipt_number text, raw_response jsonb not null default '{}',
 callback_data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.mpesa_payments enable row level security;
drop policy if exists mpesa_payments_owner_select on public.mpesa_payments;
create policy mpesa_payments_owner_select on public.mpesa_payments for select to authenticated using(user_id=(select auth.uid()));

create or replace function public.get_my_wallet() returns public.wallets language plpgsql security invoker set search_path=public as $$
declare w public.wallets;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into w from public.wallets where user_id=auth.uid()::text limit 1;
 if not found then insert into public.wallets(user_id,balance,currency,status,spending_enabled,withdrawals_enabled,preferred_currency)
 values(auth.uid()::text,0,'USD','active',true,true,'USD') returning * into w; end if;
 return w;
end $$;
revoke execute on function public.get_my_wallet() from public,anon;
grant execute on function public.get_my_wallet() to authenticated;

create or replace function public.finalize_mpesa_topup(p_checkout_request_id text,p_result_code integer,p_receipt_number text,p_result_description text,p_callback_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare tx wallet_transactions%rowtype; w wallets%rowtype; p mpesa_payments%rowtype; before_balance numeric; after_balance numeric;
begin
 select * into tx from wallet_transactions where provider_order_id=p_checkout_request_id and provider='mpesa' for update;
 if not found then return jsonb_build_object('ok',false,'reason','transaction_not_found'); end if;
 select * into p from mpesa_payments where checkout_request_id=p_checkout_request_id for update;
 if p.id is null then return jsonb_build_object('ok',false,'reason','payment_not_found'); end if;
 if tx.status='completed' then return jsonb_build_object('ok',true,'idempotent',true,'status','completed'); end if;
 if p_result_code<>0 then
   update wallet_transactions set status='failed',provider_status=coalesce(p_result_description,'FAILED'),metadata=coalesce(metadata,'{}')||jsonb_build_object('mpesa_result_code',p_result_code),updated_at=now() where id=tx.id;
   update mpesa_payments set status='failed',result_code=p_result_code,result_description=p_result_description,callback_data=coalesce(p_callback_data,'{}'),updated_at=now() where id=p.id;
   return jsonb_build_object('ok',true,'status','failed');
 end if;
 if p_receipt_number is null or length(trim(p_receipt_number))=0 then return jsonb_build_object('ok',false,'reason','receipt_required'); end if;
 select * into w from wallets where id=tx.wallet_id and user_id=tx.user_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','wallet_not_found'); end if;
 before_balance:=coalesce(w.balance,0); after_balance:=before_balance+tx.amount;
 update wallets set balance=after_balance,total_deposited=coalesce(total_deposited,0)+tx.amount,updated_at=now() where id=w.id;
 update wallet_transactions set status='completed',balance_before=before_balance,balance_after=after_balance,provider_status='COMPLETED',provider_capture_id=p_receipt_number,completed_at=now(),updated_at=now() where id=tx.id;
 update mpesa_payments set status='completed',result_code=0,result_description=p_result_description,receipt_number=p_receipt_number,callback_data=coalesce(p_callback_data,'{}'),completed_at=now(),updated_at=now() where id=p.id;
 return jsonb_build_object('ok',true,'status','completed','wallet_amount',tx.amount,'receipt_number',p_receipt_number);
end $$;
revoke all on function public.finalize_mpesa_topup(text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_mpesa_topup(text,integer,text,text,jsonb) to service_role;

create or replace function public.reserve_mpesa_withdrawal(p_user_id uuid,p_wallet_id uuid,p_amount numeric,p_currency text,p_phone text,p_amount_kes numeric,p_client_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w wallets%rowtype; before_balance numeric; after_balance numeric; tx wallet_transactions%rowtype;
begin
 if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'FORBIDDEN'; end if;
 select * into w from wallets where id=p_wallet_id and user_id=p_user_id::text for update;
 if not found then return jsonb_build_object('ok',false,'reason','wallet_not_found'); end if;
 if w.status<>'active' or w.withdrawals_enabled=false then return jsonb_build_object('ok',false,'reason','withdrawals_disabled'); end if;
 if w.balance<p_amount then return jsonb_build_object('ok',false,'reason','insufficient_balance'); end if;
 if exists(select 1 from wallet_transactions where provider='mpesa_b2c' and provider_reference=p_client_reference) then return jsonb_build_object('ok',false,'reason','duplicate_reference'); end if;
 before_balance:=w.balance; after_balance:=before_balance-p_amount;
 update wallets set balance=after_balance,updated_at=now() where id=w.id;
 insert into wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,provider_reference,provider_status,description,metadata,payment_method)
 values(w.id,p_user_id::text,'withdrawal','withdrawal',p_amount,round(p_amount*100),p_currency,'debit','pending',before_balance,after_balance,'mpesa_b2c',p_client_reference,'RESERVED','M-Pesa withdrawal',jsonb_build_object('phone',p_phone,'amount_kes',p_amount_kes),'mpesa') returning * into tx;
 return jsonb_build_object('ok',true,'transaction_id',tx.id,'client_reference',p_client_reference);
end $$;
revoke all on function public.reserve_mpesa_withdrawal(uuid,uuid,numeric,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.reserve_mpesa_withdrawal(uuid,uuid,numeric,text,text,numeric,text) to service_role;

create or replace function public.finalize_mpesa_withdrawal(p_client_reference text,p_provider_order_id text,p_result_code integer,p_transaction_id text,p_result_description text,p_result_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare tx wallet_transactions%rowtype; w wallets%rowtype; new_balance numeric;
begin
 select * into tx from wallet_transactions where provider='mpesa_b2c' and provider_reference=p_client_reference for update;
 if not found then return jsonb_build_object('ok',false,'reason','transaction_not_found'); end if;
 if tx.status='completed' then return jsonb_build_object('ok',true,'idempotent',true,'status','completed'); end if;
 select * into w from wallets where id=tx.wallet_id for update;
 if p_result_code=0 then
   update wallet_transactions set status='completed',provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_capture_id=p_transaction_id,provider_status='COMPLETED',description=coalesce(p_result_description,description),metadata=coalesce(metadata,'{}')||coalesce(p_result_data,'{}'),completed_at=now(),updated_at=now() where id=tx.id;
   update wallets set total_withdrawn=coalesce(total_withdrawn,0)+tx.amount,updated_at=now() where id=w.id;
   return jsonb_build_object('ok',true,'status','completed');
 else
   new_balance:=coalesce(w.balance,0)+tx.amount;
   update wallets set balance=new_balance,updated_at=now() where id=w.id;
   update wallet_transactions set status='failed',balance_after=new_balance,provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_status='FAILED',description=coalesce(p_result_description,description),metadata=coalesce(metadata,'{}')||coalesce(p_result_data,'{}'),updated_at=now() where id=tx.id;
   return jsonb_build_object('ok',true,'status','failed');
 end if;
end $$;
revoke all on function public.finalize_mpesa_withdrawal(text,text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_mpesa_withdrawal(text,text,integer,text,text,jsonb) to service_role;