create table if not exists public.communication_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  identity_public_key text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(user_id, device_id)
);

create table if not exists public.communication_key_envelopes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  epoch integer not null,
  sender_device_id uuid not null references public.communication_devices(id) on delete cascade,
  recipient_device_id uuid not null references public.communication_devices(id) on delete cascade,
  algorithm text not null default 'ECDH-P256-HKDF-AES-GCM',
  ciphertext text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  unique(conversation_id, epoch, recipient_device_id)
);

alter table public.call_sessions add column if not exists e2ee_enabled boolean not null default false;
alter table public.call_sessions add column if not exists e2ee_epoch integer;

create index if not exists communication_devices_user_active_idx on public.communication_devices(user_id) where revoked_at is null;
create index if not exists communication_key_envelopes_recipient_idx on public.communication_key_envelopes(recipient_device_id, conversation_id, epoch);

alter table public.communication_devices enable row level security;
alter table public.communication_key_envelopes enable row level security;

create policy communication_devices_select_own on public.communication_devices for select to authenticated using (user_id = auth.uid());
create policy communication_devices_insert_own on public.communication_devices for insert to authenticated with check (user_id = auth.uid());
create policy communication_devices_update_own on public.communication_devices for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy communication_key_envelopes_select_recipient on public.communication_key_envelopes for select to authenticated using (
  exists (select 1 from public.communication_devices d where d.id = recipient_device_id and d.user_id = auth.uid() and d.revoked_at is null)
);
create policy communication_key_envelopes_insert_sender on public.communication_key_envelopes for insert to authenticated with check (
  exists (select 1 from public.communication_devices d where d.id = sender_device_id and d.user_id = auth.uid() and d.revoked_at is null)
  and exists (select 1 from public.conversation_members cm where cm.conversation_id = communication_key_envelopes.conversation_id and cm.user_id = auth.uid())
);
