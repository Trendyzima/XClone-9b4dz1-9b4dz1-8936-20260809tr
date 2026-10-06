begin;
create schema if not exists private;
create or replace function private.create_credit_boost_internal(p_source_type text,p_source_id uuid,p_duration_hours integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_base bigint; v_cost bigint; v_wallet public.user_wallets%rowtype; v_boost public.credit_boosts%rowtype; v_existing public.credit_boosts%rowtype; v_daily_spend bigint;
begin
if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
if p_source_type not in ('post','profile') then raise exception 'INVALID_SOURCE_TYPE'; end if;
if p_duration_hours not in (24,72,168) then raise exception 'INVALID_DURATION'; end if;
if p_idempotency_key is null or length(btrim(p_idempotency_key))<16 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
select * into v_existing from public.credit_boosts where user_id=v_user and idempotency_key=p_idempotency_key limit 1;
if found then return jsonb_build_object('ok',true,'idempotent',true,'boost_id',v_existing.id,'credits_spent',v_existing.credits_spent,'ends_at',v_existing.ends_at); end if;
if p_source_type='post' then
 if not exists(select 1 from public.posts where id=p_source_id and author_id=v_user and deleted_at is null) then raise exception 'POST_NOT_OWNED'; end if; v_base:=100;
else
 if p_source_id<>v_user or not exists(select 1 from public.profiles where id=v_user) then raise exception 'PROFILE_NOT_OWNED'; end if; v_base:=250;
end if;
v_cost:=(v_base*p_duration_hours)/24;
if (select count(*) from public.credit_boosts where user_id=v_user and status='active' and ends_at>now())>=3 then raise exception 'ACTIVE_BOOST_LIMIT'; end if;
if exists(select 1 from public.credit_boosts where source_type=p_source_type and source_id=p_source_id and status='active' and ends_at>now()) then raise exception 'SOURCE_ALREADY_BOOSTED'; end if;
select coalesce(sum(amount_credits),0) into v_daily_spend from public.credit_boost_ledger where user_id=v_user and direction='debit' and created_at>=now()-interval '24 hours';
if v_daily_spend+v_cost>2000 then raise exception 'CREDIT_BOOST_DAILY_LIMIT'; end if;
insert into public.user_wallets(user_id,credits,updated_at) values(v_user,0,now()) on conflict(user_id) do update set updated_at=public.user_wallets.updated_at returning * into v_wallet;
if coalesce(v_wallet.credits,0)<v_cost then raise exception 'INSUFFICIENT_CREDITS'; end if;
update public.user_wallets set credits=credits-v_cost,updated_at=now() where user_id=v_user returning * into v_wallet;
insert into public.credit_boosts(user_id,source_type,source_id,credits_spent,duration_hours,status,starts_at,ends_at,idempotency_key,metadata)
values(v_user,p_source_type,p_source_id,v_cost,p_duration_hours,'active',now(),now()+make_interval(hours=>p_duration_hours),p_idempotency_key,jsonb_build_object('billing_unit','credits','base_daily_cost',v_base)) returning * into v_boost;
insert into public.credit_boost_ledger(user_id,boost_id,direction,amount_credits,idempotency_key,reason) values(v_user,v_boost.id,'debit',v_cost,'boost-debit:'||v_boost.id::text,'credits boost: '||p_source_type);
if p_source_type='post' then update public.posts set is_boosted=true,boost_type='credits',updated_at=now() where id=p_source_id and author_id=v_user; end if;
return jsonb_build_object('ok',true,'idempotent',false,'boost_id',v_boost.id,'source_type',v_boost.source_type,'source_id',v_boost.source_id,'credits_spent',v_cost,'wallet_credits',v_wallet.credits,'starts_at',v_boost.starts_at,'ends_at',v_boost.ends_at);
end; $$;
revoke all on function private.create_credit_boost_internal(text,uuid,integer,text) from public,anon,authenticated;
drop function if exists public.create_credit_boost(text,uuid,integer,text);
create or replace function public.create_credit_boost(p_source_type text,p_source_id uuid,p_duration_hours integer,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_credit_boost_internal(p_source_type,p_source_id,p_duration_hours,p_idempotency_key); $$;
revoke all on function public.create_credit_boost(text,uuid,integer,text) from public,anon;
grant execute on function public.create_credit_boost(text,uuid,integer,text) to authenticated;
create or replace function private.get_credit_boost_bonuses(p_source_ids uuid[],p_profile_ids uuid[])
returns table(source_type text,source_id uuid,bonus numeric)
language sql stable security definer set search_path='' as $$
select cb.source_type,cb.source_id,case when cb.source_type='post' then 7.0 else 3.0 end::numeric from public.credit_boosts cb
where cb.status='active' and cb.starts_at<=now() and cb.ends_at>now()
and ((cb.source_type='post' and cb.source_id=any(coalesce(p_source_ids,'{}'::uuid[]))) or (cb.source_type='profile' and cb.source_id=any(coalesce(p_profile_ids,'{}'::uuid[]))));
$$;
revoke all on function private.get_credit_boost_bonuses(uuid[],uuid[]) from public,anon,authenticated;
drop function if exists public.get_credit_boost_bonuses(uuid[],uuid[]);
create or replace function public.get_credit_boost_bonuses(p_source_ids uuid[],p_profile_ids uuid[])
returns table(source_type text,source_id uuid,bonus numeric)
language sql stable security invoker set search_path='' as $$ select * from private.get_credit_boost_bonuses(p_source_ids,p_profile_ids); $$;
revoke all on function public.get_credit_boost_bonuses(uuid[],uuid[]) from public;
grant execute on function public.get_credit_boost_bonuses(uuid[],uuid[]) to anon,authenticated;
commit;