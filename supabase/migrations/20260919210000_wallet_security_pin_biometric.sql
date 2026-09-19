-- Wallet security: server-side PIN protection and biometric/passkey metadata.
create table if not exists public.wallet_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text,
  pin_failed_attempts integer not null default 0 check (pin_failed_attempts >= 0),
  pin_locked_until timestamptz,
  biometric_enabled boolean not null default false,
  biometric_credential_id text,
  biometric_public_key text,
  biometric_created_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.wallet_security enable row level security;
revoke all on public.wallet_security from anon, authenticated;
grant select on public.wallet_security to authenticated;
drop policy if exists wallet_security_owner_select on public.wallet_security;
create policy wallet_security_owner_select on public.wallet_security for select to authenticated
using ((select auth.uid()) = user_id);

-- PINs are bcrypt-hashed in Postgres and never returned to the client.
create or replace function public.set_wallet_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
 if p_pin !~ '^[0-9]{4,6}$' then raise exception using errcode='22023',message='PIN must contain 4 to 6 digits'; end if;
 insert into wallet_security(user_id,pin_hash,pin_failed_attempts,pin_locked_until,updated_at)
 values(u,crypt(p_pin,gen_salt('bf',12)),0,null,now())
 on conflict(user_id) do update set pin_hash=excluded.pin_hash,pin_failed_attempts=0,pin_locked_until=null,updated_at=now();
 return jsonb_build_object('success',true,'pin_set',true);
end $$;
revoke all on function public.set_wallet_pin(text) from public,anon;
grant execute on function public.set_wallet_pin(text) to authenticated;

create or replace function public.verify_wallet_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); s wallet_security%rowtype; n integer;
begin
 if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
 select * into s from wallet_security where user_id=u for update;
 if s.pin_hash is null then return jsonb_build_object('success',false,'code','PIN_NOT_SET'); end if;
 if s.pin_locked_until is not null and s.pin_locked_until>now() then return jsonb_build_object('success',false,'code','PIN_LOCKED','retry_at',s.pin_locked_until); end if;
 if crypt(p_pin,s.pin_hash)=s.pin_hash then
   update wallet_security set pin_failed_attempts=0,pin_locked_until=null,updated_at=now() where user_id=u;
   return jsonb_build_object('success',true);
 end if;
 n:=coalesce(s.pin_failed_attempts,0)+1;
 update wallet_security set pin_failed_attempts=n,pin_locked_until=case when n>=5 then now()+interval '15 minutes' else null end,updated_at=now() where user_id=u;
 return jsonb_build_object('success',false,'code',case when n>=5 then 'PIN_LOCKED' else 'INVALID_PIN' end,'attempts_remaining',greatest(0,5-n));
end $$;
revoke all on function public.verify_wallet_pin(text) from public,anon;
grant execute on function public.verify_wallet_pin(text) to authenticated;

-- Biometric unlock uses WebAuthn/passkeys; raw private biometric material is never stored.
create or replace function public.set_wallet_biometric_enabled(
 p_enabled boolean,p_credential_id text default null,p_public_key text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception using errcode='28000',message='Authentication required'; end if;
 if p_enabled and (p_credential_id is null or p_public_key is null) then
   raise exception using errcode='22023',message='A verified biometric credential is required';
 end if;
 insert into wallet_security(user_id,biometric_enabled,biometric_credential_id,biometric_public_key,biometric_created_at,updated_at)
 values(u,p_enabled,nullif(p_credential_id,''),nullif(p_public_key,''),case when p_enabled then now() else null end,now())
 on conflict(user_id) do update set biometric_enabled=excluded.biometric_enabled,biometric_credential_id=excluded.biometric_credential_id,biometric_public_key=excluded.biometric_public_key,biometric_created_at=excluded.biometric_created_at,updated_at=now();
 return jsonb_build_object('success',true,'biometric_enabled',p_enabled);
end $$;
revoke all on function public.set_wallet_biometric_enabled(boolean,text,text) from public,anon;
grant execute on function public.set_wallet_biometric_enabled(boolean,text,text) to authenticated;