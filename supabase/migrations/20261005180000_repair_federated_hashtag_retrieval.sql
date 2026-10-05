-- Repair the federated hashtag retrieval contract used by HashtagPage.
create or replace function public.get_federated_posts_for_hashtag_json(
  p_hashtag_id uuid,
  p_limit integer default 30
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.published_at desc nulls last, x.id desc), '[]'::jsonb)
  from (
    select f.id,f.uri,f.actor_uri,f.content,f.summary,f.published_at,f.updated_at,
           f.attachments,f.tags,f.like_count,f.announce_count,f.reply_count,
           f.object_type,f.url
    from public.federated_hashtag_mentions m
    join public.federated_objects f on f.id=m.object_id
    where m.hashtag_id=p_hashtag_id
      and f.deleted_at is null
      and f.tombstone=false
    order by f.published_at desc nulls last,f.id desc
    limit least(greatest(coalesce(p_limit,30),1),100)
  ) x
$$;

revoke all on function public.get_federated_posts_for_hashtag_json(uuid,integer) from public,anon;
grant execute on function public.get_federated_posts_for_hashtag_json(uuid,integer) to anon,authenticated;

create index if not exists hashtags_trending_recency_idx
  on public.hashtags(last_used_at desc,federated_post_count desc,post_count desc);


-- Atomic first-party Testagram Wallet payment for completed rides. No external payment provider required.
create or replace function public.wallet_pay_ride(p_ride_id uuid,p_amount numeric,p_currency text default 'KES',p_idempotency_key text default null) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_uid uuid:=auth.uid(); v_wallet public.wallets%rowtype; v_ride record; v_key text:=coalesce(nullif(trim(p_idempotency_key),''),'ride:'||p_ride_id::text); v_tx public.wallet_transactions%rowtype; v_txid uuid; begin if v_uid is null then raise exception 'Authentication required'; end if; if p_amount is null or p_amount<=0 or p_ride_id is null then raise exception 'Invalid ride payment'; end if; if upper(coalesce(p_currency,''))<>'KES' then raise exception 'Ride wallet payments currently require KES'; end if; select * into v_ride from public.rides where id=p_ride_id and user_id=v_uid for update; if not found then raise exception 'Ride not found'; end if; if v_ride.status<>'completed' then raise exception 'Ride is not completed'; end if; if v_ride.fare is null or abs(v_ride.fare::numeric-p_amount)>0.01 then raise exception 'Ride fare mismatch'; end if; select * into v_wallet from public.wallets where user_id=v_uid::text for update; if not found then raise exception 'Wallet not found'; end if; if coalesce(v_wallet.status,'active')<>'active' or coalesce(v_wallet.spending_enabled,true)=false then raise exception 'Wallet spending is disabled'; end if; select * into v_tx from public.wallet_transactions where user_id=v_uid::text and idempotency_key=v_key limit 1; if found then return jsonb_build_object('ok',true,'transaction_id',v_tx.id,'status',v_tx.status,'amount',v_tx.amount,'currency',v_tx.currency); end if; if v_wallet.balance<p_amount then raise exception 'Insufficient wallet balance'; end if; if coalesce(v_wallet.spend_limit_enabled,false) and v_wallet.daily_spend_limit is not null and coalesce((select sum(abs(amount)) from public.wallet_transactions where user_id=v_uid::text and direction='debit' and status='completed' and created_at>=date_trunc('day',now())),0)+p_amount>v_wallet.daily_spend_limit then raise exception 'Daily wallet spending limit exceeded'; end if; update public.wallets set balance=balance-p_amount,updated_at=now() where id=v_wallet.id; insert into public.wallet_transactions(wallet_id,user_id,kind,type,amount,currency,direction,status,balance_before,balance_after,provider,description,payment_method,reference,idempotency_key,completed_at,created_at,updated_at,metadata) values(v_wallet.id,v_uid::text,'ride_payment','ride_payment',p_amount,p_currency,'debit','completed',v_wallet.balance,v_wallet.balance-p_amount,'testagram_wallet','Ride payment','wallet','ride:'||p_ride_id::text,v_key,now(),now(),now(),jsonb_build_object('ride_id',p_ride_id,'fare',p_amount)) returning id into v_txid; insert into public.wallet_ledger(wallet_id,user_id,direction,amount_minor,currency,reason,reference_type,reference_id,idempotency_key,metadata) values(v_wallet.id,v_uid::text,'debit',round(p_amount*100)::bigint,p_currency,'ride_payment','ride',p_ride_id,v_key,jsonb_build_object('wallet_transaction_id',v_txid)); return jsonb_build_object('ok',true,'transaction_id',v_txid,'status','completed','amount',p_amount,'currency',p_currency); end $$; revoke all on function public.wallet_pay_ride(uuid,numeric,text,text) from public; grant execute on function public.wallet_pay_ride(uuid,numeric,text,text) to authenticated;