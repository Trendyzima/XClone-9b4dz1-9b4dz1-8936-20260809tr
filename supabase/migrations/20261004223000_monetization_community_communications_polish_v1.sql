-- Testagram production polish: server-authoritative rewards, durable community chat state,
-- and WhatsApp-class message forwarding primitives.
-- Idempotent and additive.

create table if not exists public.message_forwards (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid not null references public.messages(id) on delete cascade,
  target_message_id uuid not null references public.messages(id) on delete cascade,
  forwarded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(source_message_id, target_message_id)
);
alter table public.message_forwards enable row level security;
drop policy if exists message_forwards_member_read on public.message_forwards;
create policy message_forwards_member_read on public.message_forwards
for select to authenticated using (
  forwarded_by = auth.uid()
  or exists (
    select 1 from public.messages m
    join public.conversation_members cm on cm.conversation_id=m.conversation_id
    where m.id=message_forwards.target_message_id and cm.user_id=auth.uid() and cm.left_at is null
  )
);
create index if not exists message_forwards_source_idx on public.message_forwards(source_message_id,created_at desc);
create index if not exists message_forwards_target_idx on public.message_forwards(target_message_id,created_at desc);

create or replace function public.testagram_forward_message(
  p_message_id uuid,
  p_conversation_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  uid uuid := auth.uid();
  src public.messages%rowtype;
  target_id uuid;
begin
  if uid is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=uid and left_at is null)
    then raise exception using errcode='42501',message='Target conversation membership required'; end if;
  select * into src from public.messages where id=p_message_id and deleted_at is null;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if not exists(select 1 from public.conversation_members where conversation_id=src.conversation_id and user_id=uid and left_at is null)
    then raise exception using errcode='42501',message='Source conversation membership required'; end if;

  insert into public.messages(
    conversation_id,sender_id,body,client_message_id,ciphertext,nonce,aad,e2ee_enabled,
    e2ee_version,e2ee_epoch,key_epoch,message_type,reply_to_id,attachment_metadata
  ) values (
    p_conversation_id,uid,'',gen_random_uuid()::text,src.ciphertext,src.nonce,src.aad,
    coalesce(src.e2ee_enabled,true),src.e2ee_version,src.e2ee_epoch,src.key_epoch,
    'forwarded',null,coalesce(src.attachment_metadata,'[]'::jsonb)
  ) returning id into target_id;

  insert into public.message_forwards(source_message_id,target_message_id,forwarded_by)
  values(p_message_id,target_id,uid);

  return jsonb_build_object('message_id',target_id,'source_message_id',p_message_id,'forwarded',true);
end;
$$;
revoke all on function public.testagram_forward_message(uuid,uuid) from public,anon;
grant execute on function public.testagram_forward_message(uuid,uuid) to authenticated;

create table if not exists public.community_chat_reactions (
  message_id uuid not null references public.community_chat(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key(message_id,user_id,emoji)
);
alter table public.community_chat_reactions enable row level security;
drop policy if exists community_chat_reactions_member_read on public.community_chat_reactions;
create policy community_chat_reactions_member_read on public.community_chat_reactions for select to authenticated using (
  exists(select 1 from public.community_chat c join public.community_members cm on cm.community_id=c.community_id
    where c.id=community_chat_reactions.message_id and cm.user_id=auth.uid() and cm.status='active')
);
create index if not exists community_chat_reactions_message_idx on public.community_chat_reactions(message_id,created_at desc);

create table if not exists public.community_chat_pins (
  message_id uuid primary key references public.community_chat(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.community_chat_pins enable row level security;
drop policy if exists community_chat_pins_member_read on public.community_chat_pins;
create policy community_chat_pins_member_read on public.community_chat_pins for select to authenticated using (
  exists(select 1 from public.community_members cm where cm.community_id=community_chat_pins.community_id and cm.user_id=auth.uid() and cm.status='active')
);
create index if not exists community_chat_pins_community_idx on public.community_chat_pins(community_id,created_at desc);

create or replace function public.toggle_community_chat_reaction(
  p_message_id uuid,
  p_emoji text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid; normalized text:=left(btrim(coalesce(p_emoji,'❤️')),16); removed boolean:=false;
begin
  if uid is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select community_id into cid from public.community_chat where id=p_message_id;
  if cid is null or not exists(select 1 from public.community_members where community_id=cid and user_id=uid and status='active')
    then raise exception using errcode='42501',message='Active community membership required'; end if;
  if exists(select 1 from public.community_chat_reactions where message_id=p_message_id and user_id=uid and emoji=normalized) then
    delete from public.community_chat_reactions where message_id=p_message_id and user_id=uid and emoji=normalized;
    removed:=true;
  else
    insert into public.community_chat_reactions(message_id,user_id,emoji) values(p_message_id,uid,normalized) on conflict do nothing;
  end if;
  return jsonb_build_object('message_id',p_message_id,'emoji',normalized,'removed',removed);
end;
$$;
revoke all on function public.toggle_community_chat_reaction(uuid,text) from public,anon;
grant execute on function public.toggle_community_chat_reaction(uuid,text) to authenticated;

create or replace function public.toggle_community_chat_pin(p_message_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid; removed boolean:=false;
begin
  if uid is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select community_id into cid from public.community_chat where id=p_message_id;
  if cid is null or not exists(select 1 from public.community_members where community_id=cid and user_id=uid and status='active' and role in ('owner','admin','moderator'))
    then raise exception using errcode='42501',message='Community moderator permission required'; end if;
  if exists(select 1 from public.community_chat_pins where message_id=p_message_id) then
    delete from public.community_chat_pins where message_id=p_message_id;
    removed:=true;
  else
    insert into public.community_chat_pins(message_id,community_id,pinned_by) values(p_message_id,cid,uid);
  end if;
  return jsonb_build_object('message_id',p_message_id,'removed',removed);
end;
$$;
revoke all on function public.toggle_community_chat_pin(uuid) from public,anon;
grant execute on function public.toggle_community_chat_pin(uuid) to authenticated;

-- Server-authoritative daily rewards. The browser no longer needs to mutate wallet balances.
create or replace function public.claim_daily_reward()
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  uid uuid:=auth.uid();
  current_row public.daily_rewards%rowtype;
  next_streak integer;
  reward integer;
  wallet_credits numeric:=0;
  today date:=current_date;
begin
  if uid is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select * into current_row from public.daily_rewards where user_id=uid for update;
  if current_row.last_claimed_at is not null and current_row.last_claimed_at::date=today
    then raise exception using errcode='23514',message='DAILY_REWARD_ALREADY_CLAIMED'; end if;

  next_streak:=case
    when current_row.user_id is null then 1
    when current_row.last_claimed_at::date = today-1 then least(coalesce(current_row.streak_day,0)+1,7)
    else 1
  end;
  reward:=next_streak*10;

  insert into public.daily_rewards(user_id,streak_day,credits_earned,last_claimed_at)
  values(uid,next_streak,reward,now())
  on conflict(user_id) do update set streak_day=excluded.streak_day,credits_earned=excluded.credits_earned,last_claimed_at=excluded.last_claimed_at;

  select coalesce(credits,0) into wallet_credits from public.user_wallets where user_id=uid for update;
  insert into public.user_wallets(user_id,credits)
  values(uid,reward)
  on conflict(user_id) do update set credits=coalesce(public.user_wallets.credits,0)+reward;

  insert into public.credit_transactions(user_id,amount,reason,metadata)
  values(uid,reward,'daily_reward',jsonb_build_object('streak_day',next_streak));

  return jsonb_build_object('ok',true,'streak_day',next_streak,'credits_earned',reward,'credits_total',wallet_credits+reward);
end;
$$;
revoke all on function public.claim_daily_reward() from public,anon;
grant execute on function public.claim_daily_reward() to authenticated;

-- Useful advertiser analytics without exposing another user's campaign data.
create or replace function public.get_my_ad_campaign_metrics(p_campaign_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); owner_id uuid; impressions bigint:=0; clicks bigint:=0; spend bigint:=0; views bigint:=0;
begin
  if uid is null then raise exception using errcode='28000',message='Authentication required'; end if;
  select a.owner_user_id into owner_id
  from public.testagram_ad_campaigns c join public.testagram_advertisers a on a.id=c.advertiser_id
  where c.id=p_campaign_id;
  if owner_id is distinct from uid then raise exception using errcode='42501',message='Campaign ownership required'; end if;
  select count(*),coalesce(sum(case when clicked then 1 else 0 end),0),coalesce(sum(billable_micros),0)
    into impressions,clicks,spend from public.testagram_ad_impressions where campaign_id=p_campaign_id;
  return jsonb_build_object(
    'impressions',impressions,'clicks',clicks,'spend_micros',spend,
    'ctr',case when impressions>0 then round(clicks::numeric*100/impressions,2) else 0 end,
    'effective_cpm',case when impressions>0 then round(spend::numeric/1000000*1000/impressions,2) else 0 end
  );
end;
$$;
revoke all on function public.get_my_ad_campaign_metrics(uuid) from public,anon;
grant execute on function public.get_my_ad_campaign_metrics(uuid) to authenticated;
