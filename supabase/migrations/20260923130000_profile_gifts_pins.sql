-- Profile monetization/content contract: persistent pins and premium gifts.
-- Applied to production during the reconciliation pass.

alter table public.profiles add column if not exists pinned_post_id uuid null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='profiles_pinned_post_id_fkey') then
    alter table public.profiles add constraint profiles_pinned_post_id_fkey foreign key (pinned_post_id) references public.posts(id) on delete set null;
  end if;
end $$;

create table if not exists public.premium_gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  plan text not null default 'monthly' check (plan in ('monthly')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'USD',
  status text not null default 'active' check (status in ('active','expired','revoked')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  wallet_reference text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists premium_gifts_recipient_idx on public.premium_gifts(recipient_id, created_at desc);
create index if not exists premium_gifts_sender_idx on public.premium_gifts(sender_id, created_at desc);
alter table public.premium_gifts enable row level security;
drop policy if exists "premium_gifts_participants_select" on public.premium_gifts;
create policy "premium_gifts_participants_select" on public.premium_gifts for select to authenticated
using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

create or replace function public.send_premium_gift(p_recipient_id uuid, p_amount numeric default 4.99, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_sender uuid := auth.uid();
  v_amount numeric := round(p_amount,2);
  v_key text := nullif(left(btrim(coalesce(p_idempotency_key,'')),200),'');
  v_existing public.premium_gifts%rowtype;
  v_transfer jsonb;
  v_gift_id uuid;
  v_expires timestamptz := now() + interval '1 month';
begin
  if v_sender is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_recipient_id is null or p_recipient_id = v_sender then raise exception 'INVALID_RECIPIENT'; end if;
  if v_amount <> 4.99 then raise exception 'INVALID_GIFT_AMOUNT'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext(v_sender::text||':premium_gift:'||v_key));
  select * into v_existing from public.premium_gifts where idempotency_key=v_key;
  if found then
    if v_existing.sender_id<>v_sender or v_existing.recipient_id<>p_recipient_id then raise exception 'IDEMPOTENCY_KEY_REUSE'; end if;
    return jsonb_build_object('success',true,'gift_id',v_existing.id,'amount',v_existing.amount,'expires_at',v_existing.expires_at,'idempotent',true);
  end if;
  v_transfer := public.p2p_wallet_transfer(v_sender,p_recipient_id,v_amount,'Premium gift',v_key);
  insert into public.premium_gifts(sender_id,recipient_id,plan,amount,currency,status,started_at,expires_at,wallet_reference,idempotency_key)
  values(v_sender,p_recipient_id,'monthly',v_amount,'USD','active',now(),v_expires,v_transfer->>'reference',v_key)
  returning id into v_gift_id;
  return jsonb_build_object('success',true,'gift_id',v_gift_id,'amount',v_amount,'expires_at',v_expires,'idempotent',false);
end $$;
grant execute on function public.send_premium_gift(uuid,numeric,text) to authenticated;

create or replace function public.get_my_premium_status()
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object(
    'is_active', exists(select 1 from public.premium_gifts g where g.recipient_id=auth.uid() and g.status='active' and g.expires_at>now()),
    'plan', case when exists(select 1 from public.premium_gifts g where g.recipient_id=auth.uid() and g.status='active' and g.expires_at>now()) then 'monthly' else null end,
    'expires_at', (select max(g.expires_at) from public.premium_gifts g where g.recipient_id=auth.uid() and g.status='active' and g.expires_at>now())
  );
$$;
grant execute on function public.get_my_premium_status() to authenticated;
