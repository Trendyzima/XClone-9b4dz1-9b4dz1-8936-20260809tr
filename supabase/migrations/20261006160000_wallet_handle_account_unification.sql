-- Canonical handle -> wallet-account identity bridge.
-- Every local handle has one USER financial account per currency.
-- Marketplace records persist the resolved wallet account ids and validate identity.

alter table public.wallet_accounts add column if not exists wallet_address text;

update public.wallet_accounts
set wallet_address=case
  when account_type='USER' and user_id is not null then 'tg:'||user_id::text
  when account_type='DRIVER_PAYABLE' and user_id is not null then 'tg:driver:'||user_id::text
  when account_type='SAVINGS' and user_id is not null then 'tg:savings:'||user_id::text
  when account_type='PLATFORM' then 'tg:platform:'||currency
  when account_type='MPESA_CLEARING' then 'tg:mpesa-clearing:'||currency
  when account_type='MPESA_COST_RESERVE' then 'tg:mpesa-cost-reserve:'||currency
  else 'tg:account:'||id::text end
where wallet_address is null;

create unique index if not exists wallet_accounts_wallet_address_key on public.wallet_accounts(wallet_address);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='wallet_accounts_user_id_fkey') then
    alter table public.wallet_accounts add constraint wallet_accounts_user_id_fkey
      foreign key(user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

create or replace function private.set_wallet_address()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.wallet_address is null then
    new.wallet_address:=case
      when new.account_type='USER' and new.user_id is not null then 'tg:'||new.user_id::text
      when new.account_type='DRIVER_PAYABLE' and new.user_id is not null then 'tg:driver:'||new.user_id::text
      when new.account_type='SAVINGS' and new.user_id is not null then 'tg:savings:'||new.user_id::text
      when new.account_type='PLATFORM' then 'tg:platform:'||new.currency
      when new.account_type='MPESA_CLEARING' then 'tg:mpesa-clearing:'||new.currency
      when new.account_type='MPESA_COST_RESERVE' then 'tg:mpesa-cost-reserve:'||new.currency
      else 'tg:account:'||new.id::text end;
  end if;
  return new;
end $$;
revoke all on function private.set_wallet_address() from public,anon,authenticated;

drop trigger if exists wallet_accounts_address on public.wallet_accounts;
create trigger wallet_accounts_address before insert on public.wallet_accounts
for each row execute function private.set_wallet_address();

create or replace function public.resolve_wallet_handle(p_handle text,p_currency text default 'KES')
returns uuid language plpgsql security definer set search_path=''
as $$
declare h text:=lower(trim(coalesce(p_handle,''))); c text:=upper(coalesce(p_currency,'KES')); wid uuid;
begin
  if h='' then raise exception 'HANDLE_REQUIRED'; end if;
  if left(h,1)='@' then h:=substr(h,2); end if;
  select wa.id into wid
  from public.wallet_accounts wa join public.profiles p on p.id=wa.user_id
  where wa.account_type='USER' and wa.currency=c and wa.status='ACTIVE'
    and (lower(p.username)=h or lower(wa.wallet_address)=lower(trim(p_handle)))
  order by wa.created_at limit 1;
  if wid is null then raise exception 'WALLET_HANDLE_NOT_FOUND'; end if;
  return wid;
end $$;
revoke all on function public.resolve_wallet_handle(text,text) from public,anon;
grant execute on function public.resolve_wallet_handle(text,text) to authenticated;

create or replace function private.ensure_profile_wallet()
returns trigger language plpgsql security definer set search_path=''
as $$ begin perform private.ensure_user_financial_accounts(new.id,'KES'); return new; end $$;
revoke all on function private.ensure_profile_wallet() from public,anon,authenticated;
drop trigger if exists profiles_financial_accounts on public.profiles;
create trigger profiles_financial_accounts after insert on public.profiles
for each row execute function private.ensure_profile_wallet();

alter table public.products add column if not exists seller_wallet_account_id uuid;
alter table public.orders add column if not exists buyer_wallet_account_id uuid;
alter table public.orders add column if not exists seller_wallet_account_id uuid;
alter table public.marketplace_deliveries add column if not exists buyer_wallet_account_id uuid;
alter table public.marketplace_deliveries add column if not exists seller_wallet_account_id uuid;
alter table public.marketplace_deliveries add column if not exists courier_wallet_account_id uuid;

update public.products p set seller_wallet_account_id=wa.id from public.wallet_accounts wa
where p.seller_wallet_account_id is null and wa.account_type='USER' and wa.user_id=p.seller_id
and wa.currency=upper(coalesce(p.currency,'KES'));
update public.orders o set buyer_wallet_account_id=wa.id from public.wallet_accounts wa
where o.buyer_wallet_account_id is null and wa.account_type='USER' and wa.user_id=o.buyer_id
and wa.currency=upper(coalesce(o.currency,'KES'));
update public.orders o set seller_wallet_account_id=wa.id from public.wallet_accounts wa
where o.seller_wallet_account_id is null and wa.account_type='USER' and wa.user_id=o.seller_id
and wa.currency=upper(coalesce(o.currency,'KES'));
update public.marketplace_deliveries d set buyer_wallet_account_id=wa.id
from public.wallet_accounts wa,public.orders o
where d.buyer_wallet_account_id is null and o.id=d.order_id and wa.account_type='USER'
and wa.user_id=d.buyer_id and wa.currency=upper(coalesce(o.currency,'KES'));
update public.marketplace_deliveries d set seller_wallet_account_id=wa.id
from public.wallet_accounts wa,public.orders o
where d.seller_wallet_account_id is null and o.id=d.order_id and wa.account_type='USER'
and wa.user_id=d.seller_id and wa.currency=upper(coalesce(o.currency,'KES'));
update public.marketplace_deliveries d set courier_wallet_account_id=wa.id from public.wallet_accounts wa
where d.courier_wallet_account_id is null and d.courier_id is not null
and wa.account_type='DRIVER_PAYABLE' and wa.user_id=d.courier_id
and wa.currency=upper(coalesce(d.currency,'KES'));

do $$ begin
  if not exists(select 1 from pg_constraint where conname='products_seller_wallet_account_fkey') then
    alter table public.products add constraint products_seller_wallet_account_fkey
      foreign key(seller_wallet_account_id) references public.wallet_accounts(id);
  end if;
  if not exists(select 1 from pg_constraint where conname='orders_buyer_wallet_account_fkey') then
    alter table public.orders add constraint orders_buyer_wallet_account_fkey
      foreign key(buyer_wallet_account_id) references public.wallet_accounts(id);
  end if;
  if not exists(select 1 from pg_constraint where conname='orders_seller_wallet_account_fkey') then
    alter table public.orders add constraint orders_seller_wallet_account_fkey
      foreign key(seller_wallet_account_id) references public.wallet_accounts(id);
  end if;
  if not exists(select 1 from pg_constraint where conname='marketplace_deliveries_buyer_wallet_account_fkey') then
    alter table public.marketplace_deliveries add constraint marketplace_deliveries_buyer_wallet_account_fkey
      foreign key(buyer_wallet_account_id) references public.wallet_accounts(id);
  end if;
  if not exists(select 1 from pg_constraint where conname='marketplace_deliveries_seller_wallet_account_fkey') then
    alter table public.marketplace_deliveries add constraint marketplace_deliveries_seller_wallet_account_fkey
      foreign key(seller_wallet_account_id) references public.wallet_accounts(id);
  end if;
  if not exists(select 1 from pg_constraint where conname='marketplace_deliveries_courier_wallet_account_fkey') then
    alter table public.marketplace_deliveries add constraint marketplace_deliveries_courier_wallet_account_fkey
      foreign key(courier_wallet_account_id) references public.wallet_accounts(id);
  end if;
end $$;

create index if not exists products_seller_wallet_account_idx on public.products(seller_wallet_account_id);
create index if not exists orders_buyer_wallet_account_idx on public.orders(buyer_wallet_account_id);
create index if not exists orders_seller_wallet_account_idx on public.orders(seller_wallet_account_id);
create index if not exists marketplace_deliveries_buyer_wallet_account_idx on public.marketplace_deliveries(buyer_wallet_account_id);
create index if not exists marketplace_deliveries_seller_wallet_account_idx on public.marketplace_deliveries(seller_wallet_account_id);
create index if not exists marketplace_deliveries_courier_wallet_account_idx on public.marketplace_deliveries(courier_wallet_account_id);

create or replace function private.bind_marketplace_wallet_accounts()
returns trigger language plpgsql security definer set search_path=''
as $$
declare c text;
begin
  c:=upper(coalesce(new.currency,'KES'));
  if tg_table_name='products' then
    perform private.ensure_user_financial_accounts(new.seller_id,c);
    select id into new.seller_wallet_account_id from public.wallet_accounts
    where account_type='USER' and user_id=new.seller_id and currency=c limit 1;
  elsif tg_table_name='orders' then
    perform private.ensure_user_financial_accounts(new.buyer_id,c);
    perform private.ensure_user_financial_accounts(new.seller_id,c);
    select id into new.buyer_wallet_account_id from public.wallet_accounts where account_type='USER' and user_id=new.buyer_id and currency=c limit 1;
    select id into new.seller_wallet_account_id from public.wallet_accounts where account_type='USER' and user_id=new.seller_id and currency=c limit 1;
  elsif tg_table_name='marketplace_deliveries' then
    perform private.ensure_user_financial_accounts(new.buyer_id,c);
    perform private.ensure_user_financial_accounts(new.seller_id,c);
    select id into new.buyer_wallet_account_id from public.wallet_accounts where account_type='USER' and user_id=new.buyer_id and currency=c limit 1;
    select id into new.seller_wallet_account_id from public.wallet_accounts where account_type='USER' and user_id=new.seller_id and currency=c limit 1;
    if new.courier_id is not null then
      perform private.ensure_user_financial_accounts(new.courier_id,c);
      select id into new.courier_wallet_account_id from public.wallet_accounts where account_type='DRIVER_PAYABLE' and user_id=new.courier_id and currency=c limit 1;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.bind_marketplace_wallet_accounts() from public,anon,authenticated;

drop trigger if exists products_wallet_binding on public.products;
create trigger products_wallet_binding before insert on public.products for each row execute function private.bind_marketplace_wallet_accounts();
drop trigger if exists orders_wallet_binding on public.orders;
create trigger orders_wallet_binding before insert on public.orders for each row execute function private.bind_marketplace_wallet_accounts();
drop trigger if exists marketplace_deliveries_wallet_binding on public.marketplace_deliveries;
create trigger marketplace_deliveries_wallet_binding before insert on public.marketplace_deliveries for each row execute function private.bind_marketplace_wallet_accounts();

create or replace function private.assert_marketplace_wallet_binding()
returns trigger language plpgsql security definer set search_path=''
as $$
declare expected uuid;
begin
  if tg_table_name='products' and new.seller_wallet_account_id is not null then
    select user_id into expected from public.wallet_accounts where id=new.seller_wallet_account_id and account_type='USER';
    if expected is distinct from new.seller_id then raise exception 'SELLER_WALLET_IDENTITY_MISMATCH'; end if;
  elsif tg_table_name='orders' then
    if new.buyer_wallet_account_id is not null then
      select user_id into expected from public.wallet_accounts where id=new.buyer_wallet_account_id and account_type='USER';
      if expected is distinct from new.buyer_id then raise exception 'BUYER_WALLET_IDENTITY_MISMATCH'; end if;
    end if;
    if new.seller_wallet_account_id is not null then
      select user_id into expected from public.wallet_accounts where id=new.seller_wallet_account_id and account_type='USER';
      if expected is distinct from new.seller_id then raise exception 'SELLER_WALLET_IDENTITY_MISMATCH'; end if;
    end if;
  elsif tg_table_name='marketplace_deliveries' then
    if new.buyer_wallet_account_id is not null then
      select user_id into expected from public.wallet_accounts where id=new.buyer_wallet_account_id and account_type='USER';
      if expected is distinct from new.buyer_id then raise exception 'DELIVERY_BUYER_WALLET_IDENTITY_MISMATCH'; end if;
    end if;
    if new.seller_wallet_account_id is not null then
      select user_id into expected from public.wallet_accounts where id=new.seller_wallet_account_id and account_type='USER';
      if expected is distinct from new.seller_id then raise exception 'DELIVERY_SELLER_WALLET_IDENTITY_MISMATCH'; end if;
    end if;
    if new.courier_wallet_account_id is not null then
      select user_id into expected from public.wallet_accounts where id=new.courier_wallet_account_id and account_type='DRIVER_PAYABLE';
      if expected is distinct from new.courier_id then raise exception 'DELIVERY_COURIER_WALLET_IDENTITY_MISMATCH'; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.assert_marketplace_wallet_binding() from public,anon,authenticated;

drop trigger if exists products_wallet_identity_guard on public.products;
create trigger products_wallet_identity_guard before insert or update on public.products for each row execute function private.assert_marketplace_wallet_binding();
drop trigger if exists orders_wallet_identity_guard on public.orders;
create trigger orders_wallet_identity_guard before insert or update on public.orders for each row execute function private.assert_marketplace_wallet_binding();
drop trigger if exists marketplace_deliveries_wallet_identity_guard on public.marketplace_deliveries;
create trigger marketplace_deliveries_wallet_identity_guard before insert or update on public.marketplace_deliveries for each row execute function private.assert_marketplace_wallet_binding();