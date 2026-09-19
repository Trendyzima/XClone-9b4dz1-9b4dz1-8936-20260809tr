-- Canonical Refer & Earn contract.
-- The referral relationship is created once per referred account and rewards are
-- minted only after the referred account completes the qualifying activation.
-- No client can directly write referral/reward rows.

alter table public.referrals alter column referred_id drop not null;
alter table public.referrals alter column referred_id drop not null;
alter table public.referrals add column if not exists completed_at timestamptz;
alter table public.referrals add column if not exists reward_amount_minor bigint not null default 0;
alter table public.referrals add column if not exists reward_currency text not null default 'CREDITS';
alter table public.referrals add column if not exists reward_idempotency_key text;
create unique index if not exists referrals_code_key on public.referrals(code) where code is not null;
create unique index if not exists referrals_reward_key on public.referrals(reward_idempotency_key) where reward_idempotency_key is not null;
create index if not exists referrals_referrer_status_idx on public.referrals(referrer_id,status,created_at desc);

create or replace function public.ensure_referral_code()
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user_id uuid:=auth.uid(); v_code text;
begin
 if v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
 select code into v_code from public.referrals where referrer_id=v_user_id and referred_id is null limit 1;
 if v_code is not null then return v_code; end if;
 v_code:=upper(substr(replace(v_user_id::text,'-',''),1,10));
 insert into public.referrals(id,referrer_id,referred_id,code,status) values(gen_random_uuid(),v_user_id,null,v_code,'code')
 on conflict do nothing;
 return v_code;
end; $$;

create or replace function public.apply_referral_code(p_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user_id uuid:=auth.uid(); v_referrer uuid; v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 if v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
 if v_code='' then raise exception using errcode='22023',message='Referral code is required'; end if;
 select referrer_id into v_referrer from public.referrals where code=v_code and referred_id is null limit 1;
 if v_referrer is null then raise exception using errcode='P0002',message='Referral code not found'; end if;
 if v_referrer=v_user_id then raise exception using errcode='22023',message='Cannot use your own referral code'; end if;
 if exists(select 1 from public.referrals where referred_id=v_user_id) then raise exception using errcode='23505',message='REFERRAL_ALREADY_APPLIED'; end if;
 insert into public.referrals(id,referrer_id,referred_id,code,status) values(gen_random_uuid(),v_referrer,v_user_id,v_code,'pending');
 return jsonb_build_object('ok',true,'status','pending');
end; $$;

create or replace function public.get_referral_status()
returns jsonb language sql security definer set search_path=pg_catalog,public as $
select jsonb_build_object(
 'code',(select r.code from public.referrals r where r.referrer_id=auth.uid() and r.referred_id is null limit 1),
 'referred_count',(select count(*) from public.referrals r where r.referrer_id=auth.uid() and r.referred_id is not null),
 'pending_count',(select count(*) from public.referrals r where r.referrer_id=auth.uid() and r.status='pending'),
 'completed_count',(select count(*) from public.referrals r where r.referrer_id=auth.uid() and r.status='completed'),
 'earned_credits',(select coalesce(sum(r.reward_amount_minor),0) from public.referrals r where r.referrer_id=auth.uid() and r.status='completed')
) where auth.uid() is not null;
$;

create or replace function public.get_referral_status()
returns jsonb language sql security definer set search_path=pg_catalog,public as $
select jsonb_build_object('code',(select r.code from public.referrals r where r.referrer_id=auth.uid() and r.referred_id is null limit 1),'referred_count',(select count(*) from public.referrals r where r.referrer_id=auth.uid() and r.referred_id is not null),'pending_count',(select count(*) from public.referrals r where r.referrer_id=auth.uid() and r.status='pending'),'completed_count',(select count(*) from public.referrals r where r.referrer_id=auth.uid() and r.status='completed'),'earned_credits',(select coalesce(sum(r.reward_amount_minor),0) from public.referrals r where r.referrer_id=auth.uid() and r.status='completed')) where auth.uid() is not null;
$;

create or replace function public.complete_referral()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user_id uuid:=auth.uid(); v_ref public.referrals%rowtype; v_amount bigint:=100; v_key text; v_ref_event uuid:=gen_random_uuid(); v_referred_event uuid:=gen_random_uuid(); v_ref_wallet bigint; v_self_wallet bigint;
begin
 if v_user_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
 select * into v_ref from public.referrals where referred_id=v_user_id and status='pending' for update;
 if v_ref.id is null then return jsonb_build_object('ok',true,'completed',false,'reason','NO_PENDING_REFERRAL'); end if;
 v_key:='referral:'||v_ref.id::text;
 update public.referrals set status='completed',completed_at=now(),reward_amount_minor=v_amount,reward_currency='CREDITS',reward_idempotency_key=v_key where id=v_ref.id;
 insert into public.user_wallets(user_id,credits,updated_at) values(v_ref.referrer_id,v_amount,now()) on conflict(user_id) do update set credits=user_wallets.credits+excluded.credits,updated_at=now() returning credits into v_ref_wallet;
 insert into public.user_wallets(user_id,credits,updated_at) values(v_user_id,v_amount,now()) on conflict(user_id) do update set credits=user_wallets.credits+excluded.credits,updated_at=now() returning credits into v_self_wallet;
 insert into public.reward_events(id,user_id,reward_type,amount_minor,currency,source,source_id,idempotency_key,created_at) values(v_ref_event,v_ref.referrer_id,'referral',v_amount,'CREDITS','referrals',v_ref.id,v_key,now()) on conflict(idempotency_key) do nothing;
 insert into public.reward_events(id,user_id,reward_type,amount_minor,currency,source,source_id,idempotency_key,created_at) values(v_referred_event,v_user_id,'referral_signup',v_amount,'CREDITS','referrals',v_ref.id,v_key||':referred',now()) on conflict(idempotency_key) do nothing;
 return jsonb_build_object('ok',true,'completed',true,'reward_credits',v_amount,'referrer_id',v_ref.referrer_id,'referrer_wallet_credits',v_ref_wallet,'referred_wallet_credits',v_self_wallet);
end; $$;

revoke all on function public.ensure_referral_code() from public,anon,authenticated;
revoke all on function public.apply_referral_code(text) from public,anon,authenticated;
revoke all on function public.get_referral_status() from public,anon,authenticated;
revoke all on function public.get_referral_status() from public,anon,authenticated;
revoke all on function public.complete_referral() from public,anon,authenticated;
grant execute on function public.ensure_referral_code() to authenticated;
grant execute on function public.apply_referral_code(text) to authenticated;
grant execute on function public.get_referral_status() to authenticated;
grant execute on function public.get_referral_status() to authenticated;
grant execute on function public.complete_referral() to authenticated;

revoke insert,update,delete on public.referrals from authenticated;
revoke insert,update,delete on public.reward_events from authenticated;

insert into public.capability_registry(name,version,access,readonly,enabled,description)
values
('testagram.referrals.code',1,'authenticated',false,true,'Get or create current user referral code'),
('testagram.referrals.apply',1,'authenticated',false,true,'Apply a referral code once to the current account'),
('testagram.referrals.complete',1,'authenticated',false,true,'Complete a pending referral and award both users once'),
('testagram.referrals.status',1,'authenticated',true,true,'Read referral status'),
('testagram.referrals.read',1,'authenticated',true,true,'Read referral history'),
('testagram.referrals.leaderboard',1,'authenticated',true,true,'Read aggregate referral leaderboard'),
('testagram.referrals.status',1,'authenticated',true,true,'Read current referral code and referral reward status'),
('testagram.referrals.read',1,'authenticated',true,true,'Read referral status and history')
on conflict(name) do update set version=excluded.version,access=excluded.access,readonly=excluded.readonly,enabled=true,description=excluded.description,updated_at=now();


create or replace function public.list_referrals()
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'referred_id',r.referred_id,'status',r.status,'credits_awarded',r.reward_amount_minor,'created_at',r.created_at,'completed_at',r.completed_at,'profile',case when p.id is null then null else jsonb_build_object('username',p.username,'avatar_url',p.avatar_url,'verified',coalesce(p.verified,false)) end) order by r.created_at desc) from public.referrals r left join public.profiles p on p.id=r.referred_id where r.referrer_id=auth.uid() and r.referred_id is not null),'[]'::jsonb));
$$;

create or replace function public.referral_leaderboard()
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('items',coalesce((select jsonb_agg(x.obj order by x.referral_count desc,x.credits desc,x.username) from (select r.referrer_id,jsonb_build_object('userId',r.referrer_id,'username',coalesce(p.username,'user'),'avatar',p.avatar_url,'verified',coalesce(p.verified,false),'count',count(*)::integer,'credits',coalesce(sum(r.reward_amount_minor),0)::bigint) obj,count(*)::integer referral_count,coalesce(sum(r.reward_amount_minor),0)::bigint credits,coalesce(p.username,'user') username from public.referrals r join public.profiles p on p.id=r.referrer_id where r.referred_id is not null and r.status='completed' group by r.referrer_id,p.username,p.avatar_url,p.verified order by count(*) desc,coalesce(sum(r.reward_amount_minor),0) desc,coalesce(p.username,'user') limit 10) x),'[]'::jsonb));
$$;

revoke all on function public.list_referrals() from public,anon,authenticated;
revoke all on function public.referral_leaderboard() from public,anon,authenticated;
grant execute on function public.list_referrals() to authenticated;
grant execute on function public.referral_leaderboard() to authenticated;
