alter table public.creator_earnings add column if not exists wallet_credited boolean not null default false;
create index if not exists creator_earnings_wallet_pending_idx on public.creator_earnings(creator_id,wallet_credited,status,created_at);

create or replace function public.claim_creator_earnings_to_wallet()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); total_kes numeric:=0; total_source numeric:=0; wallet public.wallets%rowtype; before_balance numeric; txid uuid; ua uuid; pa uuid; r record; rate numeric:=130;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into wallet from public.wallets where user_id=u::text for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 if upper(coalesce(wallet.currency,'KES'))<>'KES' then raise exception 'WALLET_CURRENCY_NOT_SUPPORTED'; end if;
 for r in select * from public.creator_earnings where coalesce(creator_id,user_id)=u and coalesce(wallet_credited,false)=false and status in ('completed','paid') for update loop
   total_source:=total_source+coalesce(r.amount,0);
   total_kes:=total_kes+case when upper(coalesce(r.currency,'KES'))='KES' then coalesce(r.amount,0) else round(coalesce(r.amount,0)*rate,2) end;
 end loop;
 if total_kes<=0 then raise exception 'NO_UNCLAIMED_CREATOR_EARNINGS'; end if;
 perform private.ensure_user_financial_accounts(u,'KES');
 select id into ua from public.wallet_accounts where account_type='USER' and user_id=u and currency='KES';
 select id into pa from public.wallet_accounts where account_type='PLATFORM' and currency='KES' limit 1;
 before_balance:=coalesce(wallet.balance,0);
 update public.wallets set balance=balance+total_kes,updated_at=now() where id=wallet.id;
 txid:=private.post_wallet_ledger('CREATOR_EARNINGS_CLAIM','creator_earnings',u,'creator-earnings-claim:'||u::text||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMSUS'),'Creator earnings wallet credit',jsonb_build_array(
   jsonb_build_object('account_id',pa,'direction','DEBIT','amount_minor',round(total_kes*100)::bigint),
   jsonb_build_object('account_id',ua,'direction','CREDIT','amount_minor',round(total_kes*100)::bigint)
 ),jsonb_build_object('source_total',total_source,'credited_kes',total_kes,'fx_rate_kes_per_usd',rate));
 insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,amount_cents,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at,metadata)
 values(wallet.id,u::text,'creator_earnings_claim','creator_earnings_claim',total_kes,round(total_kes*100)::bigint,'KES','in','completed',before_balance,before_balance+total_kes,'testagram_platform','Creator earnings credited to Wallet','wallet','creator-earnings','creator-earnings:'||u::text||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMSUS'),now(),now(),now(),jsonb_build_object('source_total',total_source,'fx_rate_kes_per_usd',rate,'ledger_posted',true,'ledger_transaction_id',txid));
 update public.creator_earnings set wallet_credited=true where coalesce(creator_id,user_id)=u and coalesce(wallet_credited,false)=false and status in ('completed','paid');
 return jsonb_build_object('ok',true,'credited_kes',total_kes,'source_amount',total_source,'currency','KES','ledger_transaction_id',txid);
end;
$$;
revoke all on function public.claim_creator_earnings_to_wallet() from public,anon;
grant execute on function public.claim_creator_earnings_to_wallet() to authenticated;
