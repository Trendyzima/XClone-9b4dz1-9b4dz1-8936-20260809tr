-- Communications modernization v3: delivery receipts, disappearing messages, view-once primitives,
-- polls, invite codes and indexes for WhatsApp-class chat behavior.

alter table public.messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists forwarded_from_id uuid,
  add column if not exists view_once boolean not null default false,
  add column if not exists viewed_at timestamptz,
  add column if not exists expires_at timestamptz;

alter table public.conversations
  add column if not exists invite_code text,
  add column if not exists disappearing_seconds integer;

alter table public.conversation_settings
  add column if not exists read_receipts_enabled boolean not null default true,
  add column if not exists media_auto_download boolean not null default true;

create unique index if not exists idx_conversations_invite_code on public.conversations(invite_code) where invite_code is not null;
create index if not exists idx_messages_conversation_created on public.messages(conversation_id,created_at desc);
create index if not exists idx_messages_expires_at on public.messages(expires_at) where expires_at is not null;
create index if not exists idx_message_delivery_unread on public.messages(conversation_id,read_at) where read_at is null;

create table if not exists public.message_polls(
  message_id uuid primary key references public.messages(id) on delete cascade,
  question text not null,
  allows_multiple boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.message_poll_options(
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.message_polls(message_id) on delete cascade,
  label text not null,
  position integer not null default 0
);
create table if not exists public.message_poll_votes(
  option_id uuid not null references public.message_poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(option_id,user_id)
);
alter table public.message_polls enable row level security;
alter table public.message_poll_options enable row level security;
alter table public.message_poll_votes enable row level security;

create or replace function public.communication_message_defaults()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare ttl integer;
begin
  select coalesce(cs.disappearing_seconds,c.disappearing_seconds) into ttl
  from public.conversations c
  left join public.conversation_settings cs on cs.conversation_id=c.id and cs.user_id=new.sender_id
  where c.id=new.conversation_id;
  if ttl is not null and ttl > 0 then new.expires_at := coalesce(new.expires_at, now() + make_interval(secs => ttl)); end if;
  new.delivered_at := coalesce(new.delivered_at, now());
  return new;
end;
$$;
revoke all on function public.communication_message_defaults() from public,anon,authenticated;
drop trigger if exists messages_communication_defaults on public.messages;
create trigger messages_communication_defaults before insert on public.messages for each row execute function public.communication_message_defaults();

create or replace function public.expire_communication_messages()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  update public.messages set deleted_at=coalesce(deleted_at,now()),updated_at=now(),body='',ciphertext=null,nonce=null,aad=null
  where expires_at is not null and expires_at <= now() and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.expire_communication_messages() from public,anon,authenticated;
