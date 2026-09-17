create table if not exists public.premium_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly','annual')), status text not null default 'pending' check (status in ('pending','active','cancelled','expired','failed')),
  price numeric(12,2) not null check (price > 0), currency text not null default 'USD' check (currency='USD'), started_at timestamptz, expires_at timestamptz, cancelled_at timestamptz,
  provider text not null default 'paypal' check (provider='paypal'), provider_order_id text, provider_capture_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists premium_subscriptions_provider_order_uidx on public.premium_subscriptions(provider_order_id) where provider_order_id is not null;
create unique index if not exists premium_subscriptions_provider_capture_uidx on public.premium_subscriptions(provider_capture_id) where provider_capture_id is not null;
create unique index if not exists premium_subscriptions_one_current_uidx on public.premium_subscriptions(user_id) where status in ('pending','active');
create index if not exists premium_subscriptions_user_status_idx on public.premium_subscriptions(user_id,status,expires_at desc);
alter table public.premium_subscriptions enable row level security;
revoke all on public.premium_subscriptions from anon;
grant select on public.premium_subscriptions to authenticated;
drop policy if exists premium_subscriptions_select_own on public.premium_subscriptions;
create policy premium_subscriptions_select_own on public.premium_subscriptions for select to authenticated using ((select auth.uid())=user_id);

create table if not exists public.premium_payment_orders (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, subscription_id uuid not null references public.premium_subscriptions(id) on delete cascade,
  plan text not null check (plan in ('monthly','annual')), amount numeric(12,2) not null check (amount>0), currency text not null default 'USD' check(currency='USD'), provider text not null default 'paypal' check(provider='paypal'),
  provider_order_id text not null unique, provider_capture_id text unique, status text not null default 'created' check(status in ('created','captured','failed','cancelled')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.premium_payment_orders enable row level security;
revoke all on public.premium_payment_orders from anon;
grant select on public.premium_payment_orders to authenticated;
drop policy if exists premium_payment_orders_select_own on public.premium_payment_orders;
create policy premium_payment_orders_select_own on public.premium_payment_orders for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.expire_premium_subscriptions() returns integer language plpgsql security definer set search_path=pg_catalog,public as $$ declare n integer; begin update public.premium_subscriptions set status='expired',updated_at=now() where status='active' and expires_at is not null and expires_at<=now(); get diagnostics n=row_count; return n; end; $$;
revoke all on function public.expire_premium_subscriptions() from public,anon; grant execute on function public.expire_premium_subscriptions() to authenticated;

create or replace function public.finalize_premium_paypal(p_order_id text,p_capture_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare o public.premium_payment_orders%rowtype; s public.premium_subscriptions%rowtype; days_to_add integer; begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into o from public.premium_payment_orders where provider_order_id=p_order_id and user_id=auth.uid() for update; if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 select * into s from public.premium_subscriptions where id=o.subscription_id for update; if s.user_id<>auth.uid() then raise exception 'FORBIDDEN'; end if;
 if o.status='captured' and s.status='active' then return jsonb_build_object('ok',true,'already_captured',true,'expires_at',s.expires_at); end if;
 if o.status<>'created' then raise exception 'ORDER_NOT_CAPTUREABLE'; end if;
 days_to_add:=case when s.plan='annual' then 365 else 30 end;
 update public.premium_payment_orders set status='captured',provider_capture_id=p_capture_id,updated_at=now() where id=o.id;
 update public.premium_subscriptions set status='active',started_at=coalesce(started_at,now()),expires_at=now()+make_interval(days=>days_to_add),provider_capture_id=p_capture_id,updated_at=now() where id=s.id;
 return jsonb_build_object('ok',true,'already_captured',false,'expires_at',now()+make_interval(days=>days_to_add));
end; $$;
revoke all on function public.finalize_premium_paypal(text,text) from public,anon; grant execute on function public.finalize_premium_paypal(text,text) to authenticated;

create or replace function public.cancel_premium_subscription() returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$ declare n integer; begin if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; update public.premium_subscriptions set status='cancelled',cancelled_at=now(),updated_at=now() where user_id=auth.uid() and status='active'; get diagnostics n=row_count; return n>0; end; $$;
revoke all on function public.cancel_premium_subscription() from public,anon; grant execute on function public.cancel_premium_subscription() to authenticated;

create or replace function public.get_my_premium_status() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare s public.premium_subscriptions%rowtype; begin if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; perform public.expire_premium_subscriptions(); select * into s from public.premium_subscriptions where user_id=auth.uid() and status='active' and expires_at>now() order by expires_at desc limit 1; if not found then return jsonb_build_object('is_active',false,'plan',null,'expires_at',null); end if; return jsonb_build_object('is_active',true,'plan',s.plan,'expires_at',s.expires_at); end; $$;
revoke all on function public.get_my_premium_status() from public,anon; grant execute on function public.get_my_premium_status() to authenticated;
