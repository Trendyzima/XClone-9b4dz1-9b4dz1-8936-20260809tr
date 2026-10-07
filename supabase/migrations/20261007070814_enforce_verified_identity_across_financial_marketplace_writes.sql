-- Central KYC enforcement for user-controlled financial and marketplace writes.
create or replace function private.require_verified_identity(p_user_id uuid, p_operation text default 'restricted_operation')
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile_status text;
  v_verified_at timestamptz;
  v_identity_status text;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select identity_verification_status, identity_verified_at
    into v_profile_status, v_verified_at
  from public.profiles
  where id = p_user_id;
  if v_profile_status is distinct from 'approved' or v_verified_at is null then
    raise exception 'IDENTITY_VERIFICATION_REQUIRED' using detail = p_operation;
  end if;
  select status into v_identity_status
  from public.identity_verifications
  where user_id = p_user_id
  order by reviewed_at desc nulls last, updated_at desc
  limit 1;
  if v_identity_status is distinct from 'approved' then
    raise exception 'IDENTITY_VERIFICATION_REQUIRED' using detail = p_operation;
  end if;
end;
$$;

revoke all on function private.require_verified_identity(uuid,text) from public, anon, authenticated;
grant execute on function private.require_verified_identity(uuid,text) to service_role;

create or replace function private.enforce_verified_marketplace_order()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then return new; end if;
  perform private.require_verified_identity(new.buyer_id, 'marketplace_order_buyer');
  perform private.require_verified_identity(new.seller_id, 'marketplace_order_seller');
  return new;
end; $$;

create or replace function private.enforce_verified_delivery()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then return new; end if;
  perform private.require_verified_identity(new.buyer_id, 'marketplace_delivery_buyer');
  perform private.require_verified_identity(new.seller_id, 'marketplace_delivery_seller');
  if new.courier_id is not null then perform private.require_verified_identity(new.courier_id, 'marketplace_delivery_courier'); end if;
  return new;
end; $$;

create or replace function private.enforce_verified_delivery_agent()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id = auth.uid() then perform private.require_verified_identity(new.user_id, 'marketplace_delivery_agent'); end if;
  return new;
end; $$;

create or replace function private.enforce_verified_wallet_debit()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user_id uuid;
begin
  if auth.uid() is null then return new; end if;
  if lower(coalesce(new.direction,'')) in ('out','debit') then
    v_user_id := nullif(new.user_id,'')::uuid;
    if v_user_id = auth.uid() then perform private.require_verified_identity(v_user_id, 'wallet_debit'); end if;
  end if;
  return new;
end; $$;

create or replace function private.enforce_verified_payout()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id = auth.uid() then perform private.require_verified_identity(new.user_id, 'payout'); end if;
  return new;
end; $$;

create or replace function private.enforce_verified_payout_account()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id = auth.uid() then perform private.require_verified_identity(new.user_id, 'payout_account'); end if;
  return new;
end; $$;

create or replace function private.enforce_verified_product_write()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.seller_id = auth.uid() or new.user_id = auth.uid() then perform private.require_verified_identity(auth.uid(), 'marketplace_seller'); end if;
  return new;
end; $$;

drop trigger if exists marketplace_orders_identity_gate on public.orders;
create trigger marketplace_orders_identity_gate before insert or update on public.orders for each row execute function private.enforce_verified_marketplace_order();

drop trigger if exists marketplace_deliveries_identity_gate on public.marketplace_deliveries;
create trigger marketplace_deliveries_identity_gate before insert or update on public.marketplace_deliveries for each row execute function private.enforce_verified_delivery();

drop trigger if exists marketplace_delivery_agents_identity_gate on public.marketplace_delivery_agents;
create trigger marketplace_delivery_agents_identity_gate before insert or update on public.marketplace_delivery_agents for each row execute function private.enforce_verified_delivery_agent();

drop trigger if exists wallet_transactions_identity_gate on public.wallet_transactions;
create trigger wallet_transactions_identity_gate before insert on public.wallet_transactions for each row execute function private.enforce_verified_wallet_debit();

drop trigger if exists payouts_identity_gate on public.payouts;
create trigger payouts_identity_gate before insert on public.payouts for each row execute function private.enforce_verified_payout();

drop trigger if exists payout_accounts_identity_gate on public.payout_accounts;
create trigger payout_accounts_identity_gate before insert or update on public.payout_accounts for each row execute function private.enforce_verified_payout_account();

drop trigger if exists marketplace_products_identity_gate on public.products;
create trigger marketplace_products_identity_gate before insert or update on public.products for each row execute function private.enforce_verified_product_write();
