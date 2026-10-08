create extension if not exists pgcrypto;

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  from_address text not null,
  to_addresses text[] not null check (cardinality(to_addresses) > 0),
  subject text not null,
  text_body text,
  html_body text,
  reply_to text,
  headers_json jsonb not null default '{}'::jsonb,
  idempotency_key text,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  next_attempt_at timestamptz not null default now()
);

create unique index if not exists mail_messages_idempotency_key_uq
  on public.mail_messages(idempotency_key)
  where idempotency_key is not null;

create index if not exists mail_messages_queue_idx
  on public.mail_messages(status, next_attempt_at, created_at);

create or replace function public.claim_mail_message(p_max_attempts integer default 8)
returns setof public.mail_messages
language plpgsql
security definer
set search_path = public
as $$
declare v public.mail_messages;
begin
  update public.mail_messages
  set status='sending', attempts=attempts+1, updated_at=now()
  where id = (
    select id from public.mail_messages
    where status='queued'
      and next_attempt_at <= now()
      and attempts < p_max_attempts
    order by created_at
    for update skip locked
    limit 1
  )
  returning * into v;
  if v.id is not null then return next v; end if;
  return;
end $$;

create or replace function public.mail_messages_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

drop trigger if exists mail_messages_updated_at on public.mail_messages;
create trigger mail_messages_updated_at before update on public.mail_messages
for each row execute function public.mail_messages_set_updated_at();

alter table public.mail_messages enable row level security;
revoke all on public.mail_messages from anon, authenticated;
grant select,insert,update,delete on public.mail_messages to service_role;
revoke all on function public.claim_mail_message(integer) from public, anon, authenticated;
grant execute on function public.claim_mail_message(integer) to service_role;

create or replace function public.mail_messages_retry(
  p_id uuid, p_error text, p_retry boolean
) returns void language sql security definer set search_path=public as $$
  update public.mail_messages
  set status=case when p_retry then 'queued' else 'failed' end,
      last_error=left(p_error,2000),
      next_attempt_at=case when p_retry then now()+least(interval '1 hour', (interval '5 seconds' * power(2,greatest(attempts-1,0)))) else next_attempt_at end,
      updated_at=now()
  where id=p_id;
$$;
revoke all on function public.mail_messages_retry(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.mail_messages_retry(uuid,text,boolean) to service_role;
