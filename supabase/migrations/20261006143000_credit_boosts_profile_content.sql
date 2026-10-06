begin;

alter table public.boosts
  add column if not exists funding_source text not null default 'wallet',
  add column if not exists credit_budget bigint not null default 0,
  add column if not exists credit_spent bigint not null default 0,
  add column if not exists target_type text not null default 'post',
  add column if not exists target_id uuid;

update public.boosts set target_type='post', target_id=post_id
where target_id is null and post_id is not null;

alter table public.boosts drop constraint if exists boosts_funding_source_check;
alter table public.boosts add constraint boosts_funding_source_check check (funding_source in ('wallet','credits'));
alter table public.boosts drop constraint if exists boosts_target_type_check;
alter table public.boosts add constraint boosts_target_type_check check (target_type in ('post','profile'));
alter table public.boosts drop constraint if exists boosts_credit_budget_check;
alter table public.boosts add constraint boosts_credit_budget_check check (credit_budget >= 0 and credit_spent >= 0 and credit_spent <= credit_budget);

create index if not exists boosts_active_target_idx on public.boosts(status,target_type,target_id,ends_at) where status='active';

create table if not exists public.credit_boost_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  boost_id uuid not null references public.boosts(id) on delete cascade,
  direction text not null check (direction in ('debit','refund')),
  credits bigint not null check (credits > 0),
  idempotency_key text not null unique,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.credit_boost_ledger enable row level security;
revoke all on public.credit_boost_ledger from anon, authenticated;
grant select on public.credit_boost_ledger to authenticated;
drop policy if exists credit_boost_ledger_owner_read on public.credit_boost_ledger;
create policy credit_boost_ledger_owner_read on public.credit_boost_ledger for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.create_credit_boost(
  p_target_type text,p_target_id uuid,p_credits bigint,p_duration_days integer default 3,
  p_target_audience jsonb default '{}'::jsonb,p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); v_credits bigint:=p_credits; v_days integer:=p_duration_days;
  v_wallet public.user_wallets%rowtype; v_boost public.boosts%rowtype; v_existing uuid;
  v_key text:=nullif(trim(p_idempotency_key),'');
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_target_type not in ('post','profile') then raise exception 'INVALID_TARGET_TYPE'; end if;
  if p_target_id is null then raise exception 'TARGET_REQUIRED'; end if;
  if v_credits<50 or v_credits>10000 then raise exception 'INVALID_CREDIT_BUDGET'; end if;
  if v_days<1 or v_days>30 then raise exception 'INVALID_DURATION'; end if;
  if v_key is null or length(v_key)<16 or length(v_key)>128 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  select id into v_existing from public.credit_boost_ledger where idempotency_key=v_key and direction='debit' limit 1;
  if v_existing is not null then
    select * into v_boost from public.boosts where id=(select boost_id from public.credit_boost_ledger where id=v_existing);
    return jsonb_build_object('ok',true,'idempotent',true,'boost_id',v_boost.id,'credits',v_boost.credit_budget,'target_type',v_boost.target_type);
  end if;

  if p_target_type='post' then
    if not exists(select 1 from public.posts where id=p_target_id and coalesce(author_id,user_id)=uid and deleted_at is null) then raise exception 'POST_NOT_OWNED'; end if;
  elsif p_target_id<>uid then raise exception 'PROFILE_NOT_OWNED'; end if;

  insert into public.user_wallets(user_id,credits,updated_at) values(uid,0,now()) on conflict(user_id) do nothing;
  select * into v_wallet from public.user_wallets where user_id=uid for update;
  if coalesce(v_wallet.credits,0)<v_credits then raise exception 'INSUFFICIENT_CREDITS'; end if;
  update public.user_wallets set credits=credits-v_credits,updated_at=now() where user_id=uid;

  insert into public.boosts(user_id,created_by,post_id,budget_minor,currency,status,starts_at,ends_at,target_audience,funding_source,credit_budget,credit_spent,target_type,target_id)
  values(uid,uid,case when p_target_type='post' then p_target_id else null end,0,'CREDITS','active',now(),now()+(v_days||' days')::interval,coalesce(p_target_audience,'{}'::jsonb),'credits',v_credits,0,p_target_type,p_target_id)
  returning * into v_boost;

  insert into public.credit_boost_ledger(user_id,boost_id,direction,credits,idempotency_key,reason)
  values(uid,v_boost.id,'debit',v_credits,v_key,'credit boost funding');

  if p_target_type='post' then
    update public.posts set is_boosted=true,boost_type='credits',updated_at=now() where id=p_target_id;
  end if;

  return jsonb_build_object('ok',true,'boost_id',v_boost.id,'credits',v_credits,'target_type',p_target_type,'target_id',p_target_id,'starts_at',v_boost.starts_at,'ends_at',v_boost.ends_at);
end; $$;

revoke all on function public.create_credit_boost(text,uuid,bigint,integer,jsonb,text) from public,anon;
grant execute on function public.create_credit_boost(text,uuid,bigint,integer,jsonb,text) to authenticated;

create or replace function public.cancel_credit_boost(p_boost_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); b public.boosts%rowtype; v_refund bigint; v_key text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into b from public.boosts where id=p_boost_id and user_id=uid and funding_source='credits' for update;
  if not found then raise exception 'BOOST_NOT_FOUND'; end if;
  if b.status not in ('active','paused') then return jsonb_build_object('ok',true,'already_final',true); end if;
  v_refund:=greatest(0,b.credit_budget-b.credit_spent);
  update public.boosts set status='cancelled',ends_at=least(coalesce(ends_at,now()),now()) where id=b.id;
  if v_refund>0 then
    insert into public.user_wallets(user_id,credits,updated_at) values(uid,v_refund,now())
    on conflict(user_id) do update set credits=public.user_wallets.credits+v_refund,updated_at=now();
    v_key:='credit-boost-refund:'||b.id::text;
    insert into public.credit_boost_ledger(user_id,boost_id,direction,credits,idempotency_key,reason)
    values(uid,b.id,'refund',v_refund,v_key,'unused credit boost refund') on conflict(idempotency_key) do nothing;
  end if;
  if b.target_type='post' then
    update public.posts set is_boosted=false,boost_type=null,updated_at=now()
    where id=b.target_id and not exists(select 1 from public.boosts other where other.target_type='post' and other.target_id=b.target_id and other.status='active' and other.id<>b.id);
  end if;
  return jsonb_build_object('ok',true,'refunded_credits',v_refund);
end; $$;

revoke all on function public.cancel_credit_boost(uuid) from public,anon;
grant execute on function public.cancel_credit_boost(uuid) to authenticated;

commit;