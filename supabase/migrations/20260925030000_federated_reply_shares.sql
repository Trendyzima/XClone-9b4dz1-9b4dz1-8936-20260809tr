create table if not exists public.federated_reply_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  object_uri text not null,
  created_at timestamptz not null default now(),
  unique(user_id, object_uri)
);
create index if not exists federated_reply_shares_object_uri_idx on public.federated_reply_shares(object_uri);
alter table public.federated_reply_shares enable row level security;
drop policy if exists "users can manage own federated reply shares" on public.federated_reply_shares;
create policy "users can manage own federated reply shares" on public.federated_reply_shares
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
