-- Incoming-call delivery: make ringing calls visible to callees, attach only verified Auth phone identity,
-- and enqueue a durable notification so background/native push can wake the recipient.
create or replace function public.prepare_incoming_call() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_phone text;
  caller_phone_verified boolean := false;
  caller_name text;
  caller_username text;
  caller_avatar text;
  recipient uuid;
begin
  select nullif(u.phone, ''), (u.phone is not null and u.phone_confirmed_at is not null),
    p.display_name, p.username, p.avatar_url
  into caller_phone, caller_phone_verified, caller_name, caller_username, caller_avatar
  from auth.users u left join public.profiles p on p.id = u.id where u.id = new.created_by;

  update public.calls
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'caller_phone', case when caller_phone_verified then caller_phone else null end,
    'caller_phone_verified', caller_phone_verified,
    'caller_display_name', coalesce(caller_name, caller_username, 'Testagram user'),
    'caller_username', caller_username, 'caller_avatar_url', caller_avatar,
    'incoming_signal_version', 1)
  where id = new.id;

  insert into public.call_participants(call_id, user_id, joined_at, role)
  select new.id, cm.user_id, null, 'callee'
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id and cm.user_id <> new.created_by and cm.left_at is null
  on conflict (call_id, user_id) do nothing;

  for recipient in
    select cm.user_id from public.conversation_members cm
    where cm.conversation_id = new.conversation_id and cm.user_id <> new.created_by and cm.left_at is null
  loop
    perform public.create_domain_notification(
      recipient, 'call.incoming', new.created_by, null, 'call.incoming',
      jsonb_build_object(
        'call_id', new.id, 'conversation_id', new.conversation_id, 'kind', new.kind, 'status', new.status,
        'action_url', '/call/' || new.id::text || '?kind=' || coalesce(new.kind, 'video')
          || '&conversation=' || new.conversation_id::text || '&initiator=0',
        'caller_display_name', coalesce(caller_name, caller_username, 'Testagram user'),
        'caller_username', caller_username, 'caller_avatar_url', caller_avatar,
        'caller_phone', case when caller_phone_verified then caller_phone else null end,
        'caller_phone_verified', caller_phone_verified),
      'incoming-call:' || new.id::text || ':' || recipient::text);
  end loop;
  return new;
end;
$$;

revoke all on function public.prepare_incoming_call() from public, anon, authenticated;
drop trigger if exists calls_prepare_incoming_signal on public.calls;
create trigger calls_prepare_incoming_signal after insert on public.calls
for each row execute function public.prepare_incoming_call();

create index if not exists idx_call_participants_user_active
  on public.call_participants(user_id, left_at, joined_at);
