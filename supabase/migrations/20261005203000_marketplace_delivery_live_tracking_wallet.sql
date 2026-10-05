begin;
create table if not exists public.marketplace_delivery_agents (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text, phone text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.marketplace_delivery_agents enable row level security;
drop policy if exists delivery_agents_self on public.marketplace_delivery_agents;
create policy delivery_agents_self on public.marketplace_delivery_agents for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create table if not exists public.marketplace_deliveries (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id) on delete cascade,
 buyer_id uuid not null references auth.users(id), seller_id uuid not null references auth.users(id),
 courier_id uuid references auth.users(id),
 status text not null default 'pending' check(status in('pending','assigned','picked_up','in_transit','delivered','cancelled')),
 pickup_address text, dropoff_address text not null, pickup_lat double precision, pickup_lng double precision,
 dropoff_lat double precision, dropoff_lng double precision, courier_lat double precision, courier_lng double precision,
 courier_updated_at timestamptz, eta_minutes integer, delivery_fee_minor bigint not null default 0,
 currency text not null default 'KES', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists marketplace_deliveries_buyer_idx on public.marketplace_deliveries(buyer_id,created_at desc);
create index if not exists marketplace_deliveries_courier_idx on public.marketplace_deliveries(courier_id,status);
alter table public.marketplace_deliveries enable row level security;
drop policy if exists delivery_read_participants on public.marketplace_deliveries;
create policy delivery_read_participants on public.marketplace_deliveries for select to authenticated using(buyer_id=auth.uid() or seller_id=auth.uid() or courier_id=auth.uid());
drop policy if exists delivery_agent_update on public.marketplace_deliveries;
create policy delivery_agent_update on public.marketplace_deliveries for update to authenticated using(courier_id=auth.uid()) with check(courier_id=auth.uid());

create table if not exists public.marketplace_delivery_events (
 id bigint generated always as identity primary key, delivery_id uuid not null references public.marketplace_deliveries(id) on delete cascade,
 status text not null, latitude double precision, longitude double precision, eta_minutes integer, note text, created_at timestamptz not null default now()
);
create index if not exists marketplace_delivery_events_idx on public.marketplace_delivery_events(delivery_id,created_at desc);
alter table public.marketplace_delivery_events enable row level security;
drop policy if exists delivery_events_read_participants on public.marketplace_delivery_events;
create policy delivery_events_read_participants on public.marketplace_delivery_events for select to authenticated using(exists(select 1 from public.marketplace_deliveries d where d.id=delivery_id and(d.buyer_id=auth.uid() or d.seller_id=auth.uid() or d.courier_id=auth.uid())));

create or replace function public.create_marketplace_delivery(p_order_id uuid) returns uuid language plpgsql security definer set search_path=''
as $f$
declare o public.orders%rowtype; d uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into o from public.orders where id=p_order_id and buyer_id=auth.uid() for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if o.delivery_mode='pickup' then raise exception 'DELIVERY_NOT_REQUIRED'; end if;
 if nullif(trim(coalesce(o.delivery_address,'')),'') is null then raise exception 'DELIVERY_ADDRESS_REQUIRED'; end if;
 insert into public.marketplace_deliveries(order_id,buyer_id,seller_id,status,dropoff_address,delivery_fee_minor,currency)
 values(o.id,o.buyer_id,o.seller_id,'pending',o.delivery_address,coalesce(o.delivery_fee_minor,0),upper(coalesce(o.currency,'KES')))
 on conflict(order_id) do update set updated_at=now() returning id into d;
 update public.orders set delivery_status='pending',updated_at=now() where id=o.id;
 return d;
end $f$;

create or replace function public.claim_marketplace_delivery(p_delivery_id uuid) returns boolean language plpgsql security definer set search_path=''
as $f$
begin
 if not exists(select 1 from public.marketplace_delivery_agents where user_id=auth.uid() and active) then raise exception 'DELIVERY_AGENT_NOT_ACTIVE'; end if;
 update public.marketplace_deliveries set courier_id=auth.uid(),status='assigned',updated_at=now() where id=p_delivery_id and status='pending' and courier_id is null;
 if not found then return false; end if;
 insert into public.marketplace_delivery_events(delivery_id,status,note) values(p_delivery_id,'assigned','Courier accepted delivery');
 return true;
end $f$;

create or replace function public.update_marketplace_delivery_location(p_delivery_id uuid,p_lat double precision,p_lng double precision,p_status text default 'in_transit',p_eta_minutes integer default null)
returns boolean language plpgsql security definer set search_path=''
as $f$
declare oid uuid;
begin
 if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'INVALID_COORDINATES'; end if;
 if p_status not in('assigned','picked_up','in_transit','delivered') then raise exception 'INVALID_STATUS'; end if;
 update public.marketplace_deliveries set status=p_status,courier_lat=p_lat,courier_lng=p_lng,courier_updated_at=now(),eta_minutes=greatest(0,coalesce(p_eta_minutes,eta_minutes)),updated_at=now()
 where id=p_delivery_id and courier_id=auth.uid() and status not in('delivered','cancelled') returning order_id into oid;
 if not found then return false; end if;
 insert into public.marketplace_delivery_events(delivery_id,status,latitude,longitude,eta_minutes) values(p_delivery_id,p_status,p_lat,p_lng,p_eta_minutes);
 if p_status='delivered' then update public.orders set delivery_status='delivered',delivered_at=now(),updated_at=now() where id=oid; end if;
 return true;
end $f$;

revoke all on function public.create_marketplace_delivery(uuid) from public,anon; grant execute on function public.create_marketplace_delivery(uuid) to authenticated;
revoke all on function public.claim_marketplace_delivery(uuid) from public,anon; grant execute on function public.claim_marketplace_delivery(uuid) to authenticated;
revoke all on function public.update_marketplace_delivery_location(uuid,double precision,double precision,text,integer) from public,anon; grant execute on function public.update_marketplace_delivery_location(uuid,double precision,double precision,text,integer) to authenticated;

alter table public.marketplace_deliveries replica identity full;
alter table public.marketplace_delivery_events replica identity full;
do $f$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='marketplace_deliveries') then alter publication supabase_realtime add table public.marketplace_deliveries; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='marketplace_delivery_events') then alter publication supabase_realtime add table public.marketplace_delivery_events; end if;
end $f$;
commit;