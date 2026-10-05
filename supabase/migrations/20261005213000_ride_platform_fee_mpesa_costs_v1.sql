-- Safaricom B2C registered-user business tariff, verified 2026-10-05.
create table if not exists public.mpesa_b2c_registered_tariffs (
  min_amount numeric(12,2) primary key,
  max_amount numeric(12,2) not null,
  business_fee numeric(12,2) not null,
  source text not null,
  verified_at timestamptz not null default now()
);
truncate public.mpesa_b2c_registered_tariffs;
insert into public.mpesa_b2c_registered_tariffs(min_amount,max_amount,business_fee,source) values
(1,49,0,'Safaricom M-PESA B2C registered-user tariff'),(50,100,0,'Safaricom M-PESA B2C registered-user tariff'),
(101,500,5,'Safaricom M-PESA B2C registered-user tariff'),(501,1000,5,'Safaricom M-PESA B2C registered-user tariff'),(1001,1500,5,'Safaricom M-PESA B2C registered-user tariff'),
(1501,2500,9,'Safaricom M-PESA B2C registered-user tariff'),(2501,3500,9,'Safaricom M-PESA B2C registered-user tariff'),(3501,5000,9,'Safaricom M-PESA B2C registered-user tariff'),
(5001,7500,11,'Safaricom M-PESA B2C registered-user tariff'),(7501,10000,11,'Safaricom M-PESA B2C registered-user tariff'),(10001,15000,11,'Safaricom M-PESA B2C registered-user tariff'),(15001,20000,11,'Safaricom M-PESA B2C registered-user tariff'),
(20001,25000,13,'Safaricom M-PESA B2C registered-user tariff'),(25001,30000,13,'Safaricom M-PESA B2C registered-user tariff'),(30001,35000,13,'Safaricom M-PESA B2C registered-user tariff'),(35001,40000,13,'Safaricom M-PESA B2C registered-user tariff'),(40001,45000,13,'Safaricom M-PESA B2C registered-user tariff'),(45001,50000,13,'Safaricom M-PESA B2C registered-user tariff'),(50001,70000,13,'Safaricom M-PESA B2C registered-user tariff'),(70001,250000,13,'Safaricom M-PESA B2C registered-user tariff');
alter table public.mpesa_b2c_registered_tariffs enable row level security;
revoke all on public.mpesa_b2c_registered_tariffs from anon,authenticated;
create policy mpesa_b2c_tariffs_deny_direct on public.mpesa_b2c_registered_tariffs for select to authenticated using(false);

create or replace function public.mpesa_b2c_registered_business_fee_kes(p_amount numeric)
returns numeric language sql stable security definer set search_path=''
as $$ select coalesce((select business_fee from public.mpesa_b2c_registered_tariffs where p_amount between min_amount and max_amount),0)::numeric; $$;
revoke all on function public.mpesa_b2c_registered_business_fee_kes(numeric) from public,authenticated;

create or replace function public.wallet_ride_fee_quote(p_ride_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); r public.rides%rowtype; fare numeric; platform_fee numeric; driver_payout numeric; mpesa_fee numeric; total numeric;
begin
 if u is null then raise exception 'Authentication required'; end if;
 select * into r from public.rides where id=p_ride_id and user_id=u;
 if not found then raise exception 'Ride not found'; end if;
 if r.fare is null or r.fare<=0 then raise exception 'Ride has no payable fare'; end if;
 fare:=round(r.fare::numeric,2); platform_fee:=round(fare*0.10,2); driver_payout:=round(fare-platform_fee,2);
 if driver_payout>250000 then raise exception 'Ride payout exceeds M-Pesa B2C maximum'; end if;
 mpesa_fee:=public.mpesa_b2c_registered_business_fee_kes(driver_payout); total:=round(fare+platform_fee+mpesa_fee,2);
 return jsonb_build_object('ok',true,'fare',fare,'platform_fee',platform_fee,'mpesa_b2c_fee',mpesa_fee,'driver_payout',driver_payout,'total_charge',total,'currency','KES','fee_rate',0.10);
end $$;
revoke all on function public.wallet_ride_fee_quote(uuid) from public;
grant execute on function public.wallet_ride_fee_quote(uuid) to authenticated;

-- wallet_pay_ride is updated in the live Supabase migration with the same quote:
-- total_charge = fare + round(fare*10%) + Safaricom B2C business fee(driver payout = fare - 10%).
-- The transaction metadata records the Safaricom cost reserve for reconciliation.