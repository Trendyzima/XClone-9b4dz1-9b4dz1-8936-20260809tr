-- Schema-aligned notification delivery: durable in-app rows, realtime, and optional Web Push outbox.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  platform text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create table if not exists public.notification_push_config (
  id boolean primary key default true check(id), worker_token text not null, vapid_subject text not null,
  vapid_public_key text not null, vapid_private_key text not null, updated_at timestamptz not null default now()
);
revoke all on public.notification_push_config from public,anon,authenticated;

create table if not exists public.notification_delivery_outbox (
  id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade, event_name text not null,
  payload jsonb not null default '{}'::jsonb, status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
  attempts integer not null default 0, last_error text, next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(), sent_at timestamptz, unique(notification_id)
);
create index if not exists notification_delivery_outbox_pending_idx on public.notification_delivery_outbox(status,next_attempt_at,created_at);
alter table public.notification_delivery_outbox enable row level security;
revoke all on public.notification_delivery_outbox from public,anon,authenticated;

create or replace function public.create_domain_notification(p_recipient_id uuid,p_kind text,p_actor_id uuid default null,p_post_id uuid default null,p_type text default null,p_data jsonb default '{}'::jsonb,p_unique_key text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 if p_recipient_id is null or (p_actor_id is not null and p_actor_id=p_recipient_id) then return null; end if;
 if p_unique_key is not null then select n.id into v_id from public.notifications n where n.data->>'dedupe_key'=p_unique_key order by n.created_at desc limit 1; if v_id is not null then return v_id; end if; end if;
 insert into public.notifications(recipient_id,actor_id,post_id,kind,type,from_user_id,user_id,data,read,read_at)
 values(p_recipient_id,p_actor_id,p_post_id,coalesce(nullif(p_kind,''),'social'),coalesce(nullif(p_type,''),p_kind),p_actor_id,p_recipient_id,coalesce(p_data,'{}'::jsonb)||case when p_unique_key is null then '{}'::jsonb else jsonb_build_object('dedupe_key',p_unique_key) end,false,null)
 returning id into v_id; return v_id;
end; $$;
revoke all on function public.create_domain_notification(uuid,text,uuid,uuid,text,jsonb,text) from public,anon,authenticated;

create or replace function public.enqueue_notification_delivery() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.notification_delivery_outbox(notification_id,recipient_id,event_name,payload)
 values(new.id,new.recipient_id,coalesce(new.kind,new.type,'notification'),jsonb_build_object('notification_id',new.id,'recipient_id',new.recipient_id,'actor_id',new.actor_id,'kind',coalesce(new.kind,new.type,'notification'),'post_id',new.post_id,'data',coalesce(new.data,'{}'::jsonb)))
 on conflict(notification_id) do nothing; return new;
end; $$;
drop trigger if exists notifications_enqueue_delivery on public.notifications;
create trigger notifications_enqueue_delivery after insert on public.notifications for each row execute function public.enqueue_notification_delivery();
revoke all on function public.enqueue_notification_delivery() from public,anon,authenticated;

create or replace function public.notify_social_action_v2() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_recipient uuid; v_post uuid; v_kind text;
begin
 if TG_TABLE_NAME='post_reactions' then v_post:=new.post_id; select coalesce(p.author_id,p.user_id) into v_recipient from public.posts p where p.id=v_post; v_kind:='like';
 elsif TG_TABLE_NAME='reposts' then v_post:=new.post_id; select coalesce(p.author_id,p.user_id) into v_recipient from public.posts p where p.id=v_post; v_kind:='repost';
 elsif TG_TABLE_NAME='replies' then v_post:=new.post_id; select coalesce(p.author_id,p.user_id) into v_recipient from public.posts p where p.id=v_post; v_kind:='reply';
 elsif TG_TABLE_NAME='follows' then v_recipient:=new.following_id; v_kind:='follow';
 elsif TG_TABLE_NAME='posts' and new.quoted_post_id is not null then v_post:=new.quoted_post_id; select coalesce(p.author_id,p.user_id) into v_recipient from public.posts p where p.id=v_post; v_kind:='quote'; end if;
 if v_recipient is not null and (v_actor is null or v_actor<>v_recipient) then
  perform public.create_domain_notification(v_recipient,v_kind,v_actor,v_post,v_kind,jsonb_build_object('action_url',case when v_post is null then '/profile/'||coalesce((select username from public.profiles where id=v_actor),'') else '/post/'||v_post::text end),v_kind||':'||coalesce(v_post::text,v_recipient::text)||':'||coalesce(v_actor::text,'system')||':'||date_trunc('hour',now())::text);
 end if; return new;
end; $$;
revoke all on function public.notify_social_action_v2() from public,anon,authenticated;
drop trigger if exists notification_post_reaction on public.post_reactions;
create trigger notification_post_reaction after insert on public.post_reactions for each row execute function public.notify_social_action_v2();
drop trigger if exists notification_repost on public.reposts;
create trigger notification_repost after insert on public.reposts for each row execute function public.notify_social_action_v2();
drop trigger if exists notification_reply on public.replies;
create trigger notification_reply after insert on public.replies for each row execute function public.notify_social_action_v2();
drop trigger if exists notification_follow on public.follows;
create trigger notification_follow after insert on public.follows for each row execute function public.notify_social_action_v2();
drop trigger if exists notification_quote on public.posts;
create trigger notification_quote after insert on public.posts for each row when (new.quoted_post_id is not null) execute function public.notify_social_action_v2();

create or replace function public.claim_notification_delivery_batch(p_limit integer default 20) returns table(id uuid,notification_id uuid,recipient_id uuid,event_name text,payload jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin return query with candidates as (select o.id from public.notification_delivery_outbox o where o.status in ('pending','failed') and o.next_attempt_at<=now() order by o.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,20),50))) update public.notification_delivery_outbox o set status='processing',attempts=o.attempts+1,last_error=null from candidates c where o.id=c.id returning o.id,o.notification_id,o.recipient_id,o.event_name,o.payload; end; $$;
create or replace function public.complete_notification_delivery(p_id uuid) returns void language sql security definer set search_path=public,pg_temp as $$ update public.notification_delivery_outbox set status='sent',sent_at=now(),next_attempt_at=now() where id=p_id; $$;
create or replace function public.fail_notification_delivery(p_id uuid,p_error text) returns void language sql security definer set search_path=public,pg_temp as $$ update public.notification_delivery_outbox set status='failed',last_error=left(coalesce(p_error,'delivery failed'),500),next_attempt_at=now()+least(interval '1 hour',interval '5 seconds'*power(2,greatest(0,attempts-1))) where id=p_id; $$;
revoke all on function public.claim_notification_delivery_batch(integer) from public,anon,authenticated;
revoke all on function public.complete_notification_delivery(uuid) from public,anon,authenticated;
revoke all on function public.fail_notification_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_notification_delivery_batch(integer) to service_role;
grant execute on function public.complete_notification_delivery(uuid) to service_role;
grant execute on function public.fail_notification_delivery(uuid,text) to service_role;
