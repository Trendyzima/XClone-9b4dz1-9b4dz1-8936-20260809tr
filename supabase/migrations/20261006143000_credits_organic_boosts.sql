-- Credits-powered organic boosts.
-- Credits are non-monetary platform credits. They are never converted to cash
-- and browser clients cannot mutate the balance or ledger directly.

begin;

create table if not exists public.credit_boosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('post','profile')),
  source_id uuid not null,
  credits_spent bigint not null check (credits_spent > 0),
  duration_hours integer not null check (duration_hours in (24,72,168)),
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id,idempotency_key),
  check (ends_at > starts_at)
);

create index if not exists credit_boosts_active_source_idx
  on public.credit_boosts(source_type,source_id,status,ends_at desc);
create index if not exists credit_boosts_user_idx
  on public.credit_boosts(user_id,created_at desc);
create unique index if not exists credit_boosts_one_active_source_uidx
  on public.credit_boosts(source_type,source_id)
  where status='active';

create table if not exists public.credit_boost_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  boost_id uuid references public.credit_boosts(id) on delete set null,
  direction text not null check (direction in ('debit','refund')),
  amount_credits bigint not null check (amount_credits > 0),
  idempotency_key text not null unique,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists credit_boost_ledger_user_idx
  on public.credit_boost_ledger(user_id,created_at desc);

alter table public.credit_boosts enable row level security;
alter table public.credit_boost_ledger enable row level security;

revoke all on public.credit_boosts from anon,authenticated;
revoke all on public.credit_boost_ledger from anon,authenticated;
grant select on public.credit_boosts to authenticated;
grant select on public.credit_boost_ledger to authenticated;

drop policy if exists credit_boosts_owner_select on public.credit_boosts;
create policy credit_boosts_owner_select on public.credit_boosts
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists credit_boost_ledger_owner_select on public.credit_boost_ledger;
create policy credit_boost_ledger_owner_select on public.credit_boost_ledger
for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.get_my_credit_balance()
returns bigint
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  select coalesce((select credits from public.user_wallets where user_id=(select auth.uid())),0);
$$;

revoke all on function public.get_my_credit_balance() from public,anon;
grant execute on function public.get_my_credit_balance() to authenticated;

create or replace function public.create_credit_boost(
  p_source_type text,
  p_source_id uuid,
  p_duration_hours integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_base bigint;
  v_cost bigint;
  v_wallet public.user_wallets%rowtype;
  v_boost public.credit_boosts%rowtype;
  v_existing public.credit_boosts%rowtype;
  v_daily_spend bigint;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_source_type not in ('post','profile') then raise exception 'INVALID_SOURCE_TYPE'; end if;
  if p_duration_hours not in (24,72,168) then raise exception 'INVALID_DURATION'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 16 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;

  select * into v_existing
  from public.credit_boosts
  where user_id=v_user and idempotency_key=p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'ok',true,'idempotent',true,'boost_id',v_existing.id,
      'credits_spent',v_existing.credits_spent,'ends_at',v_existing.ends_at
    );
  end if;

  if p_source_type='post' then
    if not exists (
      select 1 from public.posts
      where id=p_source_id and author_id=v_user and deleted_at is null
    ) then raise exception 'POST_NOT_OWNED'; end if;
    v_base := 100;
  else
    if p_source_id <> v_user or not exists(select 1 from public.profiles where id=v_user) then
      raise exception 'PROFILE_NOT_OWNED';
    end if;
    v_base := 250;
  end if;

  v_cost := (v_base * p_duration_hours) / 24;

  if (
    select count(*)
    from public.credit_boosts
    where user_id=v_user and status='active' and ends_at > now()
  ) >= 3 then
    raise exception 'ACTIVE_BOOST_LIMIT';
  end if;

  if exists (
    select 1 from public.credit_boosts
    where source_type=p_source_type and source_id=p_source_id
      and status='active' and ends_at > now()
  ) then
    raise exception 'SOURCE_ALREADY_BOOSTED';
  end if;

  select coalesce(sum(l.amount_credits),0) into v_daily_spend
  from public.credit_boost_ledger l
  where l.user_id=v_user
    and l.direction='debit'
    and l.created_at >= now() - interval '24 hours';

  if v_daily_spend + v_cost > 2000 then
    raise exception 'CREDIT_BOOST_DAILY_LIMIT';
  end if;

  insert into public.user_wallets(user_id,credits,updated_at)
  values(v_user,0,now())
  on conflict(user_id) do update set updated_at=public.user_wallets.updated_at
  returning * into v_wallet;

  if coalesce(v_wallet.credits,0) < v_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.user_wallets
  set credits=credits-v_cost, updated_at=now()
  where user_id=v_user
  returning * into v_wallet;

  insert into public.credit_boosts(
    user_id,source_type,source_id,credits_spent,duration_hours,status,starts_at,ends_at,idempotency_key,metadata
  )
  values(
    v_user,p_source_type,p_source_id,v_cost,p_duration_hours,'active',now(),
    now() + make_interval(hours=>p_duration_hours),p_idempotency_key,
    jsonb_build_object('billing_unit','credits','base_daily_cost',v_base)
  )
  returning * into v_boost;

  insert into public.credit_boost_ledger(
    user_id,boost_id,direction,amount_credits,idempotency_key,reason
  )
  values(
    v_user,v_boost.id,'debit',v_cost,'boost-debit:'||v_boost.id::text,
    'credits boost: '||p_source_type
  );

  if p_source_type='post' then
    update public.posts
    set is_boosted=true, boost_type='credits', updated_at=now()
    where id=p_source_id and author_id=v_user;
  end if;

  return jsonb_build_object(
    'ok',true,'idempotent',false,'boost_id',v_boost.id,
    'source_type',v_boost.source_type,'source_id',v_boost.source_id,
    'credits_spent',v_cost,'wallet_credits',v_wallet.credits,
    'starts_at',v_boost.starts_at,'ends_at',v_boost.ends_at
  );
end;
$$;

revoke all on function public.create_credit_boost(text,uuid,integer,text) from public,anon;
grant execute on function public.create_credit_boost(text,uuid,integer,text) to authenticated;

create or replace function public.get_credit_boost_bonuses(p_source_ids uuid[],p_profile_ids uuid[])
returns table(source_type text,source_id uuid,bonus numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select cb.source_type,cb.source_id,
         case when cb.source_type='post' then 7.0 else 3.0 end::numeric
  from public.credit_boosts cb
  where cb.status='active'
    and cb.starts_at <= now()
    and cb.ends_at > now()
    and (
      (cb.source_type='post' and cb.source_id = any(coalesce(p_source_ids,'{}'::uuid[])))
      or
      (cb.source_type='profile' and cb.source_id = any(coalesce(p_profile_ids,'{}'::uuid[])))
    );
$$;

revoke all on function public.get_credit_boost_bonuses(uuid[],uuid[]) from public;
grant execute on function public.get_credit_boost_bonuses(uuid[],uuid[]) to anon,authenticated;

create or replace function public.testagram_credit_boost_bonus(p_source_type text,p_source_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    max(case when source_type='post' then 7.0 when source_type='profile' then 3.0 else 0 end),
    0
  )
  from public.credit_boosts
  where source_type=p_source_type
    and source_id=p_source_id
    and status='active'
    and starts_at <= now()
    and ends_at > now();
$$;

revoke all on function public.testagram_credit_boost_bonus(text,uuid) from public,anon,authenticated;

insert into public.capability_registry(name,version,access,readonly,enabled,description)
values('testagram.credits.boost',1,'authenticated',false,true,'Spend non-monetary Testagram credits to boost owned posts or the owner profile in organic discovery.')
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,enabled=true,description=excluded.description,updated_at=now();

commit;
