-- Compatibility bridge for the currently deployed Wallet UI.
alter table public.user_wallets add column if not exists spend_limit_enabled boolean not null default false;
alter table public.user_wallets add column if not exists daily_spend_limit numeric(20,2);

create or replace view public.mpesa_transactions with (security_invoker=true) as
select id,user_id::uuid as user_id,amount,type,status,created_at,
       coalesce(metadata->>'phone',metadata->>'phone_number') as phone_number,
       provider_capture_id as mpesa_receipt_number,provider_order_id,provider_reference,metadata
from public.wallet_transactions
where provider='mpesa_b2c' and type='withdrawal';
grant select on public.mpesa_transactions to authenticated;

create or replace function public.sync_legacy_wallet_preferences()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 update public.wallets
 set spend_limit_enabled=coalesce(new.spend_limit_enabled,false),
     daily_spend_limit=new.daily_spend_limit,
     updated_at=now()
 where user_id=new.user_id::text;
 return new;
end $$;
drop trigger if exists trg_sync_legacy_wallet_preferences on public.user_wallets;
create trigger trg_sync_legacy_wallet_preferences after insert or update of spend_limit_enabled,daily_spend_limit on public.user_wallets
for each row execute function public.sync_legacy_wallet_preferences();
revoke all on function public.sync_legacy_wallet_preferences() from public,anon,authenticated;
