-- Wallet tip idempotency v2
alter table public.tips add column if not exists idempotency_key text;
create unique index if not exists tips_from_user_idempotency_uidx on public.tips(from_user_id,idempotency_key) where idempotency_key is not null;

do $realtime$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tips') then
    alter publication supabase_realtime add table public.tips;
  end if;
end
$realtime$;

create or replace function public.p2p_wallet_transfer(p_from_user_id uuid,p_to_user_id uuid,p_amount numeric,p_note text default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $f$
declare
 v_from uuid:=auth.uid(); v_from_wallet public.wallets; v_to_wallet public.wallets; v_from_balance numeric; v_to_balance numeric;
 v_ref text:='P2P-'||upper(replace(gen_random_uuid()::text,'-','')); v_amount numeric:=round(p_amount,2);
 v_note text:=nullif(left(btrim(coalesce(p_note,'')),240),''); v_key text:=nullif(left(btrim(coalesce(p_idempotency_key,'')),200),''); v_existing public.wallet_transactions%rowtype;
begin
 if v_from is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_from_user_id is null or p_from_user_id<>v_from then raise exception 'FORBIDDEN'; end if;
 if p_to_user_id is null or p_to_user_id=v_from then raise exception 'INVALID_RECIPIENT'; end if;
 if v_amount is null or v_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
 if v_key is not null then
   perform pg_advisory_xact_lock(hashtext(v_from::text||':p2p:'||v_key));
   select * into v_existing from public.wallet_transactions where user_id=v_from::text and idempotency_key=v_key and direction='out' and kind='p2p_transfer' order by created_at desc limit 1;
   if found then
     if coalesce(v_existing.metadata->>'recipient_user_id','')<>p_to_user_id::text or round(coalesce(v_existing.amount,0),2)<>v_amount then raise exception 'IDEMPOTENCY_KEY_REUSE'; end if;
     return jsonb_build_object('success',true,'reference',v_existing.provider_reference,'amount',v_existing.amount,'currency',v_existing.currency,'recipient_user_id',p_to_user_id,'idempotent',true);
   end if;
 end if;
 if v_from<p_to_user_id then
   select * into v_from_wallet from public.wallets where user_id=v_from for update;
   select * into v_to_wallet from public.wallets where user_id=p_to_user_id for update;
 else
   select * into v_to_wallet from public.wallets where user_id=p_to_user_id for update;
   select * into v_from_wallet from public.wallets where user_id=v_from for update;
 end if;
 if v_from_wallet.id is null then raise exception 'SENDER_WALLET_NOT_FOUND'; end if;
 if v_to_wallet.id is null then raise exception 'RECIPIENT_WALLET_NOT_FOUND'; end if;
 if v_from_wallet.status<>'active' or not v_from_wallet.spending_enabled then raise exception 'SENDER_WALLET_DISABLED'; end if;
 if v_to_wallet.status<>'active' then raise exception 'RECIPIENT_WALLET_DISABLED'; end if;
 if v_from_wallet.currency<>v_to_wallet.currency then raise exception 'CURRENCY_MISMATCH'; end if;
 if v_from_wallet.balance<v_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;
 v_from_balance:=v_from_wallet.balance; v_to_balance:=v_to_wallet.balance;
 update public.wallets set balance=balance-v_amount,updated_at=now() where id=v_from_wallet.id;
 update public.wallets set balance=balance+v_amount,updated_at=now() where id=v_to_wallet.id;
 insert into public.wallet_transactions(wallet_id,user_id,type,status,amount,currency,balance_before,balance_after,provider,provider_reference,description,metadata,payment_method,reference,direction,kind,idempotency_key)
 values(v_from_wallet.id,v_from,'transfer','completed',v_amount,v_from_wallet.currency,v_from_balance,v_from_balance-v_amount,'internal',v_ref,coalesce(v_note,'Wallet transfer to another Testagram user'),jsonb_build_object('transfer_ref',v_ref,'recipient_user_id',p_to_user_id,'note',v_note),'internal',v_ref,'out','p2p_transfer',v_key);
 insert into public.wallet_transactions(wallet_id,user_id,type,status,amount,currency,balance_before,balance_after,provider,provider_reference,description,metadata,payment_method,reference,direction,kind)
 values(v_to_wallet.id,p_to_user_id,'transfer','completed',v_amount,v_to_wallet.currency,v_to_balance,v_to_balance+v_amount,'internal',v_ref,coalesce(v_note,'Wallet transfer received from another Testagram user'),jsonb_build_object('transfer_ref',v_ref,'sender_user_id',v_from,'note',v_note),'internal',v_ref,'in','p2p_transfer');
 return jsonb_build_object('success',true,'reference',v_ref,'amount',v_amount,'currency',v_from_wallet.currency,'recipient_user_id',p_to_user_id,'idempotent',false);
end; $f$;

create or replace function public.send_wallet_tip(p_to_user_id uuid,p_amount numeric,p_note text default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $f$
declare v_from uuid:=auth.uid(); v_amount numeric:=round(p_amount,2); v_key text:=nullif(left(btrim(coalesce(p_idempotency_key,'')),200),''); v_transfer jsonb; v_tip_id uuid; v_existing public.tips%rowtype;
begin
 if v_from is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_to_user_id is null or p_to_user_id=v_from then raise exception 'INVALID_RECIPIENT'; end if;
 if v_amount is null or v_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
 if v_amount>10000 then raise exception 'TIP_LIMIT_EXCEEDED'; end if;
 if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtext(v_from::text||':tip:'||v_key));
 select * into v_existing from public.tips where from_user_id=v_from and idempotency_key=v_key limit 1;
 if found then
   if v_existing.to_user_id<>p_to_user_id or v_existing.amount<>round(v_amount)::bigint then raise exception 'IDEMPOTENCY_KEY_REUSE'; end if;
   return jsonb_build_object('success',true,'tip_id',v_existing.id,'amount',v_existing.amount,'recipient_user_id',v_existing.to_user_id,'idempotent',true);
 end if;
 v_transfer:=public.p2p_wallet_transfer(v_from,p_to_user_id,v_amount,p_note,v_key);
 insert into public.tips(from_user_id,to_user_id,amount,idempotency_key) values(v_from,p_to_user_id,round(v_amount)::bigint,v_key) returning id into v_tip_id;
 return v_transfer||jsonb_build_object('tip_id',v_tip_id,'idempotent',false);
end; $f$;

create or replace function public.send_wallet_tip(p_to_user_id uuid,p_amount numeric,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $f$
begin return public.send_wallet_tip(p_to_user_id,p_amount,p_note,encode(gen_random_bytes(16),'hex')); end; $f$;

revoke all on function public.p2p_wallet_transfer(uuid,uuid,numeric,text,text) from public;
revoke all on function public.send_wallet_tip(uuid,numeric,text,text) from public;
revoke all on function public.send_wallet_tip(uuid,numeric,text) from public;
grant execute on function public.p2p_wallet_transfer(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.send_wallet_tip(uuid,numeric,text,text) to authenticated;
grant execute on function public.send_wallet_tip(uuid,numeric,text) to authenticated;
