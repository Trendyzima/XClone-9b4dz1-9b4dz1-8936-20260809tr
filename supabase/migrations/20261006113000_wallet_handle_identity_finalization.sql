-- Canonical Testagram handle -> wallet identity.
-- Every active profile handle maps to exactly one KES wallet and USER ledger
-- account. The wallet address is the immutable handle address: tg:<username>.

begin;

create or replace function private.ensure_user_wallet_identity(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;

  insert into public.wallets(
    user_id,balance,currency,status,spending_enabled,withdrawals_enabled,preferred_currency
  )
  values(p_user_id::text,0,'KES','active',true,true,'KES')
  on conflict (user_id) do update
    set currency=case
          when upper(coalesce(public.wallets.currency,'KES'))='KES'
            or coalesce(public.wallets.balance,0)=0
          then 'KES' else public.wallets.currency end,
        preferred_currency=case
          when upper(coalesce(public.wallets.currency,'KES'))='KES'
            or coalesce(public.wallets.balance,0)=0
          then 'KES' else public.wallets.preferred_currency end,
        updated_at=now();

  perform private.ensure_user_financial_accounts(p_user_id,'KES');
end;
$$;
revoke all on function private.ensure_user_wallet_identity(uuid) from public,anon,authenticated;

create or replace function private.provision_wallet_after_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.ensure_user_wallet_identity(new.id);
  return new;
end;
$$;
revoke all on function private.provision_wallet_after_profile_insert() from public,anon,authenticated;

drop trigger if exists provision_profile_wallet on public.profiles;
create trigger provision_profile_wallet
after insert on public.profiles
for each row execute function private.provision_wallet_after_profile_insert();

create or replace function private.ensure_user_financial_accounts(
  p_user_id uuid,
  p_currency text default 'KES'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c text := upper(coalesce(p_currency,'KES'));
  h text;
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  if c not in ('KES','USD','EUR') then raise exception 'UNSUPPORTED_CURRENCY'; end if;

  insert into public.wallet_accounts(account_type,user_id,currency,status)
    values ('USER',p_user_id,c,'ACTIVE') on conflict do nothing;
  insert into public.wallet_accounts(account_type,user_id,currency,status)
    values ('DRIVER_PAYABLE',p_user_id,c,'ACTIVE') on conflict do nothing;
  insert into public.wallet_accounts(account_type,user_id,currency,status)
    values ('SAVINGS',p_user_id,'KES','ACTIVE') on conflict do nothing;

  select lower(btrim(username)) into h from public.profiles where id=p_user_id;
  if h is not null and c='KES' then
    update public.wallet_accounts
      set wallet_address='tg:'||h, updated_at=now()
    where account_type='USER' and user_id=p_user_id and currency='KES'
      and wallet_address is distinct from 'tg:'||h;
  end if;
end;
$$;
revoke all on function private.ensure_user_financial_accounts(uuid,text) from public,anon,authenticated;
grant execute on function private.ensure_user_financial_accounts(uuid,text) to service_role;

do $$
declare r record;
begin
  for r in select id from auth.users loop
    perform private.ensure_user_wallet_identity(r.id);
  end loop;
end;
$$;

update public.wallet_accounts wa
set wallet_address='tg:'||lower(btrim(p.username)), updated_at=now()
from public.profiles p
where wa.account_type='USER' and wa.currency='KES' and wa.user_id=p.id
  and p.username is not null
  and wa.wallet_address is distinct from 'tg:'||lower(btrim(p.username));

create or replace function public.get_my_wallet()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare w public.wallets; u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.ensure_user_wallet_identity(u);
  select * into w from public.wallets where user_id=u::text limit 1;
  if not found then raise exception 'WALLET_PROVISIONING_FAILED'; end if;
  return jsonb_build_object(
    'id',w.id,'user_id',w.user_id,'balance',w.balance,'currency',w.currency,
    'created_at',w.created_at,'updated_at',w.updated_at,
    'total_deposited',w.total_deposited,'total_withdrawn',w.total_withdrawn,
    'mpesa_phone',w.mpesa_phone,'paypal_email',w.paypal_email,'status',w.status,
    'spending_enabled',w.spending_enabled,'withdrawals_enabled',w.withdrawals_enabled,
    'spend_limit_enabled',w.spend_limit_enabled,'daily_spend_limit',w.daily_spend_limit,
    'preferred_currency',w.preferred_currency,'savings_balance',w.savings_balance
  );
end;
$function$;
revoke all on function public.get_my_wallet() from public,anon;
grant execute on function public.get_my_wallet() to authenticated;

create or replace function public.resolve_wallet_identity(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  h text := lower(regexp_replace(btrim(coalesce(p_handle,'')),'^@',''));
  account_id uuid; account_user_id uuid; wallet_id uuid;
  username text; account_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if h='' or length(h)>30 or h !~ '^[a-z0-9_][a-z0-9_.-]{1,29}$' then
    raise exception 'INVALID_WALLET_HANDLE';
  end if;

  select wa.id,wa.user_id,wa.status,p.username
    into account_id,account_user_id,account_status,username
  from public.wallet_accounts wa join public.profiles p on p.id=wa.user_id
  where wa.account_type='USER'
    and wa.currency='KES'
    and wa.status='ACTIVE'
    and (lower(p.username)=h or lower(wa.wallet_address)=lower(btrim(p_handle)))
  order by wa.created_at
  limit 1;

  if account_user_id is null then raise exception 'WALLET_HANDLE_NOT_FOUND'; end if;

  perform private.ensure_user_wallet_identity(account_user_id);
  select w.id into wallet_id from public.wallets w where w.user_id=account_user_id::text limit 1;
  if wallet_id is null then raise exception 'WALLET_IDENTITY_NOT_READY'; end if;

  return jsonb_build_object(
    'handle',username,'wallet_address','tg:'||username,'user_id',account_user_id,
    'wallet_id',wallet_id,'account_id',account_id,'currency','KES',
    'wallet_status',(select status from public.wallets where id=wallet_id),
    'account_status',account_status
  );
end;
$function$;
revoke all on function public.resolve_wallet_identity(text) from public,anon;
grant execute on function public.resolve_wallet_identity(text) to authenticated;

create or replace function public.send_wallet_money(
  p_recipient_username text,
  p_amount_kes numeric,
  p_note text default null,
  p_idempotency_key text default null,
  p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  u uuid := auth.uid(); r uuid; ps public.wallet_security%rowtype;
  key text := nullif(trim(p_idempotency_key),''); a numeric := round(p_amount_kes,2);
  resolved jsonb;
begin
  if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if a is null or a<10 or a>10000 or a<>trunc(a) then
    raise exception using errcode='22023',message='Send amount must be a whole KES amount between KES 10 and KES 10,000';
  end if;
  if key is null or length(key)<8 or key !~ '^[A-Za-z0-9:_-]+$' then
    raise exception using errcode='22023',message='Valid idempotency key is required';
  end if;

  select * into ps from public.wallet_security where user_id=u;
  if ps.pin_hash is null then raise exception using errcode='42501',message='Set your wallet PIN before sending money'; end if;
  if ps.pin_locked_until is not null and ps.pin_locked_until>now() then raise exception using errcode='42501',message='Wallet PIN is temporarily locked'; end if;
  if p_pin is null or crypt(p_pin,ps.pin_hash)<>ps.pin_hash then
    update public.wallet_security
      set pin_failed_attempts=pin_failed_attempts+1,
          pin_locked_until=case when pin_failed_attempts+1>=5 then now()+interval '15 minutes' else null end,
          updated_at=now()
      where user_id=u;
    raise exception using errcode='42501',message='Invalid wallet PIN';
  end if;
  update public.wallet_security set pin_failed_attempts=0,pin_locked_until=null,updated_at=now() where user_id=u;

  resolved := public.resolve_wallet_identity(p_recipient_username);
  r := (resolved->>'user_id')::uuid;
  if r=u then raise exception using errcode='22023',message='You cannot send money to yourself'; end if;

  return public.p2p_wallet_transfer(u,r,a,p_note,key);
end;
$function$;
revoke all on function public.send_wallet_money(text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.send_wallet_money(text,numeric,text,text,text) from public,anon;
grant execute on function public.send_wallet_money(text,numeric,text,text,text) to authenticated;

commit;
