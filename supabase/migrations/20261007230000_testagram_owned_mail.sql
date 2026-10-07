create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  from_address text not null,
  to_addresses text[] not null,
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  reply_to_addresses text[] not null default '{}',
  subject text not null,
  html text,
  text text,
  headers jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  status text not null default 'queued' check (status in ('queued','sending','retry','sent','failed','scheduled','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  message_id text
);

create index if not exists mail_messages_queue_idx
  on public.mail_messages(status, next_attempt_at, scheduled_at, created_at);

create index if not exists mail_messages_created_idx
  on public.mail_messages(created_at desc);

alter table public.mail_messages enable row level security;
revoke all on public.mail_messages from anon, authenticated;
grant select, insert, update, delete on public.mail_messages to service_role;

create table if not exists public.mail_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  status text not null default 'pending' check (status in ('pending','verified','disabled')),
  verification_token text,
  spf_verified boolean not null default false,
  dkim_verified boolean not null default false,
  dmarc_verified boolean not null default false,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.mail_domains enable row level security;
revoke all on public.mail_domains from anon, authenticated;
grant select, insert, update, delete on public.mail_domains to service_role;

comment on table public.mail_messages is 'Testagram-owned transactional email queue and delivery ledger.';
comment on table public.mail_domains is 'Testagram-owned sender-domain verification state.';
