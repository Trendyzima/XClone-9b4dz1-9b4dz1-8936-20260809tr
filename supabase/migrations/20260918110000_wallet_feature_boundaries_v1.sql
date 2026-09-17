-- Canonical Wallet feature boundaries.
-- Financial mutations stay behind authenticated RPCs; public tables are RLS-protected.

create schema if not exists private;

create table if not exists public.wallet_savings_pockets (
  wallet_id uuid primary key references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  balance numeric(20,2) not null default 0 check (balance >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);
create table if not exists public.wallet_savings_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  amount numeric(20,2) not null check (amount > 0),
  balance_before numeric(20,2) not null,
  balance_after numeric(20,2) not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.wallet_savings_goals (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  emoji text not null default '🎯',
  target_amount numeric(20,2) not null check (target_amount > 0),
  current_amount numeric(20,2) not null default 0 check (current_amount >= 0 and current_amount <= target_amount),
  is_completed boolean not null default false,
  auto_frequency text check (auto_frequency in ('weekly','monthly')),
  auto_amount numeric(20,2) check (auto_amount is null or auto_amount > 0),
  deadline date,
  color text not null default 'blue',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_transaction_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  amount numeric(20,2),
  currency text not null default 'USD',
  remind_at timestamptz not null,
  frequency text not null default 'once' check (frequency in ('once','weekly','monthly')),
  to_username text,
  is_active boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_scheduled_transfers (
  id uuid primary key default gen_random_uuid(),
  from_wallet_id uuid not null references public.wallets(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  to_username text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'USD',
  note text,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  executed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now()
);
create table if not exists public.wallet_pay_later_plans (
  id uuid primary key default gen_random_uuid(),
  from_wallet_id uuid not null references public.wallets(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  to_username text,
  total_amount numeric(20,2) not null check (total_amount > 0),
  installment_count integer not null check (installment_count between 2 and 12),
  frequency text not null check (frequency in ('weekly','monthly')),
  note text,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now()
);
create table if not exists public.wallet_pay_later_installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.wallet_pay_later_plans(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(20,2) not null check (amount > 0),
  installment_no integer not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  created_at timestamptz not null default now(),
  unique(plan_id, installment_no)
);
create table if not exists public.wallet_splits (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  total_amount numeric(20,2) not null check (total_amount > 0),
  recipient_count integer not null check (recipient_count between 1 and 5),
  note text,
  status text not null default 'completed' check (status in ('completed','failed')),
  created_at timestamptz not null default now()
);
create table if not exists public.wallet_split_recipients (
  split_id uuid not null references public.wallet_splits(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(20,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key(split_id, recipient_user_id)
);
create table if not exists public.wallet_referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  credits_awarded integer not null default 0 check (credits_awarded >= 0),
  created_at timestamptz not null default now(),
  unique(invited_user_id)
);
create table if not exists public.wallet_referral_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  referral_id uuid references public.wallet_referrals(id) on delete set null,
  amount integer not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.wallet_auto_payout_schedules (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  frequency text not null check (frequency in ('weekly','monthly')),
  minimum_amount numeric(20,2) not null check (minimum_amount > 0),
  payout_method text not null default 'mpesa',
  payout_destination text,
  is_active boolean not null default false,
  next_payout_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(wallet_id)
);

do $$
declare t text;
begin
  foreach t in array array[
    'wallet_savings_pockets','wallet_savings_ledger','wallet_savings_goals',
    'wallet_transaction_reminders','wallet_scheduled_transfers','wallet_pay_later_plans',
    'wallet_pay_later_installments','wallet_splits','wallet_split_recipients',
    'wallet_referrals','wallet_referral_credits','wallet_auto_payout_schedules'
  ] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

drop policy if exists wallet_savings_select_own on public.wallet_savings_pockets;
create policy wallet_savings_select_own on public.wallet_savings_pockets for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists wallet_savings_ledger_select_own on public.wallet_savings_ledger;
create policy wallet_savings_ledger_select_own on public.wallet_savings_ledger for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists wallet_savings_goals_own on public.wallet_savings_goals;
create policy wallet_savings_goals_own on public.wallet_savings_goals for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists wallet_reminders_own on public.wallet_transaction_reminders;
create policy wallet_reminders_own on public.wallet_transaction_reminders for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists wallet_scheduled_own on public.wallet_scheduled_transfers;
create policy wallet_scheduled_own on public.wallet_scheduled_transfers for all to authenticated using ((select auth.uid())=from_user_id) with check ((select auth.uid())=from_user_id);
drop policy if exists wallet_pay_later_own on public.wallet_pay_later_plans;
create policy wallet_pay_later_own on public.wallet_pay_later_plans for all to authenticated using ((select auth.uid())=from_user_id) with check ((select auth.uid())=from_user_id);
drop policy if exists wallet_pay_later_installments_own on public.wallet_pay_later_installments;
create policy wallet_pay_later_installments_own on public.wallet_pay_later_installments for all to authenticated using ((select auth.uid())=from_user_id) with check ((select auth.uid())=from_user_id);
drop policy if exists wallet_splits_own on public.wallet_splits;
create policy wallet_splits_own on public.wallet_splits for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists wallet_split_recipients_own on public.wallet_split_recipients;
create policy wallet_split_recipients_own on public.wallet_split_recipients for select to authenticated using (exists(select 1 from public.wallet_splits s where s.id=split_id and s.user_id=(select auth.uid())));
drop policy if exists wallet_referrals_own on public.wallet_referrals;
create policy wallet_referrals_own on public.wallet_referrals for select to authenticated using ((select auth.uid())=inviter_user_id or (select auth.uid())=invited_user_id);
drop policy if exists wallet_referral_credits_own on public.wallet_referral_credits;
create policy wallet_referral_credits_own on public.wallet_referral_credits for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists wallet_auto_payout_own on public.wallet_auto_payout_schedules;
create policy wallet_auto_payout_own on public.wallet_auto_payout_schedules for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create or replace function private.wallet_move_savings(p_amount numeric,p_direction text)
returns public.wallet_savings_pockets language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); w public.wallets%rowtype; p public.wallet_savings_pockets%rowtype; b numeric; a numeric;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_amount is null or p_amount<=0 or p_direction not in ('in','out') then raise exception 'INVALID_SAVINGS_OPERATION'; end if;
 select * into w from public.wallets where user_id=u for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 insert into public.wallet_savings_pockets(wallet_id,user_id,currency) values(w.id,u,w.currency) on conflict(wallet_id) do nothing;
 select * into p from public.wallet_savings_pockets where wallet_id=w.id for update;
 if p_direction='in' then
   if w.balance<p_amount then raise exception 'INSUFFICIENT_BALANCE'; end if;
   b:=p.balance; a:=b+p_amount; update public.wallets set balance=balance-p_amount,updated_at=now() where id=w.id;
 else
   if p.balance<p_amount then raise exception 'INSUFFICIENT_SAVINGS'; end if;
   b:=p.balance; a:=b-p_amount; update public.wallets set balance=balance+p_amount,updated_at=now() where id=w.id;
 end if;
 update public.wallet_savings_pockets set balance=a,updated_at=now() where wallet_id=w.id;
 insert into public.wallet_savings_ledger(wallet_id,user_id,direction,amount,balance_before,balance_after) values(w.id,u,p_direction,p_amount,b,a);
 select * into p from public.wallet_savings_pockets where wallet_id=w.id; return p;
end $$;

create or replace function public.wallet_move_savings(p_amount numeric,p_direction text)
returns public.wallet_savings_pockets language plpgsql security invoker set search_path=''
as $$ begin if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; return private.wallet_move_savings(p_amount,p_direction); end $$;

create or replace function public.wallet_create_scheduled_transfer(p_to_user_id uuid,p_amount numeric,p_scheduled_for timestamptz,p_note text default null)
returns public.wallet_scheduled_transfers language plpgsql security invoker set search_path=''
as $$ declare w public.wallets%rowtype; r public.wallet_scheduled_transfers;
begin
 if auth.uid() is null or p_to_user_id is null or p_to_user_id=auth.uid() or p_amount<=0 or p_scheduled_for<=now() then raise exception 'INVALID_SCHEDULE'; end if;
 select * into w from public.wallets where user_id=auth.uid(); if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 insert into public.wallet_scheduled_transfers(from_wallet_id,from_user_id,to_user_id,amount,currency,note,scheduled_for)
 values(w.id,auth.uid(),p_to_user_id,p_amount,w.currency,p_note,p_scheduled_for) returning * into r; return r;
end $$;

create or replace function public.wallet_cancel_scheduled_transfer(p_id uuid) returns boolean language plpgsql security invoker set search_path=''
as $$ begin if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; update public.wallet_scheduled_transfers set status='cancelled' where id=p_id and from_user_id=auth.uid() and status='pending'; return found; end $$;

create or replace function private.wallet_execute_scheduled_transfer(p_id uuid) returns boolean language plpgsql security definer set search_path=''
as $$ declare r public.wallet_scheduled_transfers%rowtype;
begin
 select * into r from public.wallet_scheduled_transfers where id=p_id and status='pending' and scheduled_for<=now() for update;
 if not found then return false; end if;
 update public.wallet_scheduled_transfers set status='processing' where id=p_id;
 begin perform public.p2p_wallet_transfer(r.from_user_id,r.to_user_id,r.amount,r.note);
   update public.wallet_scheduled_transfers set status='completed',executed_at=now() where id=p_id; return true;
 exception when others then update public.wallet_scheduled_transfers set status='failed',failure_reason=sqlerrm where id=p_id; return false; end;
end $$;

create or replace function public.wallet_execute_scheduled_transfer(p_id uuid) returns boolean language plpgsql security invoker set search_path=''
as $$ begin if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; if not exists(select 1 from public.wallet_scheduled_transfers where id=p_id and from_user_id=auth.uid()) then raise exception 'NOT_OWNER'; end if; return private.wallet_execute_scheduled_transfer(p_id); end $$;

create or replace function public.wallet_create_pay_later(p_to_user_id uuid,p_total numeric,p_installments integer,p_frequency text,p_note text default null)
returns public.wallet_pay_later_plans language plpgsql security invoker set search_path=''
as $$ declare w public.wallets%rowtype; p public.wallet_pay_later_plans; per numeric; i integer; due timestamptz;
begin
 if auth.uid() is null or p_to_user_id is null or p_to_user_id=auth.uid() or p_total<=0 or p_installments not between 2 and 12 or p_frequency not in ('weekly','monthly') then raise exception 'INVALID_PAY_LATER'; end if;
 select * into w from public.wallets where user_id=auth.uid(); if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 per:=round(p_total/p_installments,2);
 insert into public.wallet_pay_later_plans(from_wallet_id,from_user_id,to_user_id,total_amount,installment_count,frequency,note)
 values(w.id,auth.uid(),p_to_user_id,p_total,p_installments,p_frequency,p_note) returning * into p;
 for i in 1..p_installments loop
   due:=case when p_frequency='weekly' then now()+make_interval(days=>7*i) else now()+make_interval(months=>i) end;
   insert into public.wallet_pay_later_installments(plan_id,from_user_id,to_user_id,amount,installment_no,scheduled_for)
   values(p.id,auth.uid(),p_to_user_id,case when i=p_installments then p_total-per*(p_installments-1) else per end,i,due);
 end loop; return p;
end $$;

create or replace function public.wallet_create_split(p_total numeric,p_recipient_ids uuid[],p_note text default null)
returns uuid language plpgsql security invoker set search_path=''
as $$ declare w public.wallets%rowtype; sid uuid:=gen_random_uuid(); n int; per numeric; r uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 n:=coalesce(array_length(p_recipient_ids,1),0);
 if p_total<=0 or n<1 or n>5 then raise exception 'INVALID_SPLIT'; end if;
 if exists(select 1 from unnest(p_recipient_ids) x where x=auth.uid()) then raise exception 'INVALID_RECIPIENT'; end if;
 if (select count(distinct x) from unnest(p_recipient_ids) x)<>n then raise exception 'DUPLICATE_RECIPIENT'; end if;
 select * into w from public.wallets where user_id=auth.uid() for update;
 if not found or w.balance<p_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
 per:=round(p_total/n,2);
 insert into public.wallet_splits(id,wallet_id,user_id,total_amount,recipient_count,note) values(sid,w.id,auth.uid(),p_total,n,p_note);
 foreach r in array p_recipient_ids loop
   perform public.p2p_wallet_transfer(auth.uid(),r,per,p_note);
   insert into public.wallet_split_recipients(split_id,recipient_user_id,amount) values(sid,r,per);
 end loop; return sid;
end $$;

create or replace function public.wallet_claim_referral(p_inviter uuid) returns uuid language plpgsql security invoker set search_path=''
as $$ declare rid uuid;
begin
 if auth.uid() is null or p_inviter is null or p_inviter=auth.uid() then raise exception 'INVALID_REFERRAL'; end if;
 select id into rid from public.wallet_referrals where invited_user_id=auth.uid();
 if rid is not null then return rid; end if;
 insert into public.wallet_referrals(inviter_user_id,invited_user_id,credits_awarded) values(p_inviter,auth.uid(),100) returning id into rid;
 insert into public.wallet_referral_credits(user_id,referral_id,amount,reason) values(p_inviter,rid,100,'referral_signup');
 return rid;
end $$;

alter table public.wallets add column if not exists preferred_currency text not null default 'USD';
create or replace function public.set_wallet_preferred_currency(p_currency text) returns text language plpgsql security invoker set search_path=''
as $$ begin if auth.uid() is null or p_currency not in ('USD','KES','EUR') then raise exception 'INVALID_CURRENCY'; end if; update public.wallets set preferred_currency=p_currency,updated_at=now() where user_id=auth.uid(); if not found then raise exception 'WALLET_NOT_FOUND'; end if; return p_currency; end $$;

create or replace function public.wallet_upsert_auto_payout_schedule(p_frequency text,p_minimum_amount numeric,p_destination text,p_enabled boolean)
returns public.wallet_auto_payout_schedules language plpgsql security invoker set search_path=''
as $$ declare w public.wallets%rowtype; r public.wallet_auto_payout_schedules;
begin
 if auth.uid() is null or p_frequency not in ('weekly','monthly') or p_minimum_amount<=0 then raise exception 'INVALID_SCHEDULE'; end if;
 select * into w from public.wallets where user_id=auth.uid(); if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 insert into public.wallet_auto_payout_schedules(wallet_id,user_id,frequency,minimum_amount,payout_destination,is_active,next_payout_at)
 values(w.id,auth.uid(),p_frequency,p_minimum_amount,p_destination,p_enabled,case when p_enabled then case when p_frequency='weekly' then now()+interval '7 days' else now()+interval '1 month' end else null end)
 on conflict(wallet_id) do update set frequency=excluded.frequency,minimum_amount=excluded.minimum_amount,payout_destination=excluded.payout_destination,is_active=excluded.is_active,next_payout_at=excluded.next_payout_at,updated_at=now()
 returning * into r; return r;
end $$;

grant usage on schema private to authenticated;
grant execute on function private.wallet_move_savings(numeric,text), private.wallet_execute_scheduled_transfer(uuid) to authenticated;
grant select on public.wallet_savings_pockets,public.wallet_savings_ledger,public.wallet_savings_goals,public.wallet_transaction_reminders,public.wallet_scheduled_transfers,public.wallet_pay_later_plans,public.wallet_pay_later_installments,public.wallet_splits,public.wallet_split_recipients,public.wallet_referrals,public.wallet_referral_credits,public.wallet_auto_payout_schedules to authenticated;
grant insert,update,delete on public.wallet_savings_goals,public.wallet_transaction_reminders,public.wallet_auto_payout_schedules to authenticated;
grant execute on function public.wallet_move_savings(numeric,text),public.wallet_create_scheduled_transfer(uuid,numeric,timestamptz,text),public.wallet_cancel_scheduled_transfer(uuid),public.wallet_execute_scheduled_transfer(uuid),public.wallet_create_pay_later(uuid,numeric,integer,text,text),public.wallet_create_split(numeric,uuid[],text),public.wallet_claim_referral(uuid),public.set_wallet_preferred_currency(text),public.wallet_upsert_auto_payout_schedule(text,numeric,text,boolean) to authenticated;
