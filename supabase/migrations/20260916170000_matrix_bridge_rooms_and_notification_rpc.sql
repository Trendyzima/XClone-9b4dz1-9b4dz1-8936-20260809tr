create table if not exists public.matrix_conversation_rooms (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  room_id text not null unique,
  homeserver text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matrix_room_status_check check (status in ('pending','active','disabled')),
  constraint matrix_room_id_check check (room_id ~ '^!')
);

alter table public.matrix_conversation_rooms enable row level security;
drop policy if exists "matrix_rooms_member_read" on public.matrix_conversation_rooms;
create policy "matrix_rooms_member_read" on public.matrix_conversation_rooms
  for select to authenticated
  using (exists (select 1 from public.conversation_members cm where cm.conversation_id = matrix_conversation_rooms.conversation_id and cm.user_id = (select auth.uid())));

alter table public.matrix_identities enable row level security;
drop policy if exists "matrix_identity_select_own" on public.matrix_identities;
create policy "matrix_identity_select_own" on public.matrix_identities for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "matrix_identity_insert_own" on public.matrix_identities;
create policy "matrix_identity_insert_own" on public.matrix_identities for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "matrix_identity_update_own" on public.matrix_identities;
create policy "matrix_identity_update_own" on public.matrix_identities for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create unique index if not exists matrix_identities_matrix_user_id_uidx on public.matrix_identities(matrix_user_id);
create index if not exists matrix_rooms_homeserver_idx on public.matrix_conversation_rooms(homeserver);

create or replace function public.upsert_matrix_identity(p_matrix_user_id text, p_homeserver text) returns public.matrix_identities
language plpgsql security invoker as $$
declare r public.matrix_identities;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_matrix_user_id is null or p_matrix_user_id !~ '^@[A-Za-z0-9._=-]+:[A-Za-z0-9.-]+$' then raise exception 'invalid Matrix user id'; end if;
  if p_homeserver is null or p_homeserver !~ '^https://[^/]+$' then raise exception 'invalid homeserver'; end if;
  insert into public.matrix_identities(user_id, matrix_user_id, homeserver, updated_at)
  values (auth.uid(), p_matrix_user_id, p_homeserver, now())
  on conflict (user_id) do update set matrix_user_id = excluded.matrix_user_id, homeserver = excluded.homeserver, updated_at = now()
  returning * into r;
  return r;
end; $$;
revoke execute on function public.upsert_matrix_identity(text,text) from public;
grant execute on function public.upsert_matrix_identity(text,text) to authenticated;

create or replace function public.create_domain_notification(
  p_recipient_id uuid, p_event_type text, p_actor_id uuid default null,
  p_entity_type text default null, p_entity_id text default null,
  p_payload jsonb default '{}'::jsonb, p_unique_key text default null
) returns public.notifications
language plpgsql security invoker as $$
declare r public.notifications; v_key text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_actor_id is not null and p_actor_id <> auth.uid() then raise exception 'actor must be current user'; end if;
  if p_event_type not in ('message.created','message.reply','message.reaction','message.mention','call.incoming','call.missed','follow.created','wallet.deposit.completed','wallet.deposit.failed') then raise exception 'unsupported notification event'; end if;
  v_key := coalesce(p_unique_key, p_event_type || ':' || p_recipient_id::text || ':' || coalesce(p_entity_id,'') || ':' || md5(coalesce(p_payload::text,'')));
  insert into public.notifications(recipient_id, actor_id, kind, data, category, group_key, action_url, dedupe_key, created_at)
  values (p_recipient_id, p_actor_id, p_event_type, p_payload, 'communications', p_event_type, coalesce(p_payload->>'actionUrl','/notifications'), v_key, now())
  on conflict (dedupe_key) do update set data = excluded.data
  returning * into r;
  return r;
end; $$;
revoke execute on function public.create_domain_notification(uuid,text,uuid,text,text,jsonb,text) from public;
grant execute on function public.create_domain_notification(uuid,text,uuid,text,text,jsonb,text) to authenticated;
