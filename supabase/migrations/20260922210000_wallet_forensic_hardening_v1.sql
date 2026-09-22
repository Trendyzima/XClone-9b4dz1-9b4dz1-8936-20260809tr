-- Wallet forensic hardening v1
-- Canonical wallet tables remain the monetary source of truth.
-- mpesa_transactions is a compatibility view and is deliberately not exposed
-- to browser roles; callbacks use privileged server execution.
revoke all on public.mpesa_transactions from anon, authenticated;
grant select on public.mpesa_transactions to service_role;

do $realtime$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wallets') then
    alter publication supabase_realtime add table public.wallets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wallet_transactions') then
    alter publication supabase_realtime add table public.wallet_transactions;
  end if;
end
$realtime$;

create unique index if not exists wallet_transactions_provider_reference_uidx
  on public.wallet_transactions(provider, provider_reference)
  where provider_reference is not null;

create or replace function public.finalize_mpesa_withdrawal(
 p_client_reference text,p_provider_order_id text,p_result_code integer,p_transaction_id text,p_result_description text,p_result_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare tx public.wallet_transactions%rowtype; w public.wallets%rowtype; new_balance numeric;
begin
 if nullif(trim(p_client_reference),'') is null then return jsonb_build_object('ok',false,'reason','client_reference_required'); end if;
 select * into tx from public.wallet_transactions where provider='mpesa_b2c' and provider_reference=p_client_reference for update;
 if not found then return jsonb_build_object('ok',false,'reason','transaction_not_found'); end if;
 if tx.status in ('completed','failed','cancelled') then return jsonb_build_object('ok',true,'idempotent',true,'status',tx.status,'transaction_id',tx.id); end if;
 select * into w from public.wallets where id=tx.wallet_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','wallet_not_found'); end if;
 if p_result_code=0 then
   update public.wallet_transactions set status='completed',provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_capture_id=p_transaction_id,provider_status='COMPLETED',description=coalesce(p_result_description,description),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_result_data,'{}'::jsonb),completed_at=now(),updated_at=now() where id=tx.id;
   update public.wallets set total_withdrawn=coalesce(total_withdrawn,0)+tx.amount,updated_at=now() where id=w.id;
   return jsonb_build_object('ok',true,'status','completed','transaction_id',tx.id);
 end if;
 new_balance:=coalesce(w.balance,0)+tx.amount;
 update public.wallets set balance=new_balance,updated_at=now() where id=w.id;
 update public.wallet_transactions set status='failed',balance_after=new_balance,provider_order_id=coalesce(p_provider_order_id,provider_order_id),provider_status='FAILED',description=coalesce(p_result_description,description),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_result_data,'{}'::jsonb),updated_at=now() where id=tx.id;
 return jsonb_build_object('ok',true,'status','failed','transaction_id',tx.id);
end
$function$;
