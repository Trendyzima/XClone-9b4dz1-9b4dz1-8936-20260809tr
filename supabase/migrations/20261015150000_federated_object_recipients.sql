-- Track which local users are authorized to see followers-only and direct remote objects.
create table if not exists public.federated_object_recipients (
  object_uri text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null check (visibility in ('followers', 'direct')),
  activity_uri text,
  created_at timestamptz not null default now(),
  primary key (object_uri, user_id)
);

create index if not exists federated_object_recipients_user_created_idx
  on public.federated_object_recipients (user_id, created_at desc);

create index if not exists federated_object_recipients_object_idx
  on public.federated_object_recipients (object_uri);

alter table public.federated_object_recipients enable row level security;
revoke all on public.federated_object_recipients from anon, authenticated;

comment on table public.federated_object_recipients is
  'Per-user authorization for private and followers-only federated objects; service-role access only.';
