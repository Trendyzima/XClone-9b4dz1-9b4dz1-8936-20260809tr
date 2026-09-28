-- Fan out TV chat through Supabase Realtime Broadcast instead of per-viewer polling.
alter publication supabase_realtime drop table public.stream_chat;

create or replace function public.broadcast_stream_chat_message()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  profile_row record;
  payload jsonb;
begin
  if TG_OP <> 'INSERT' then
    return coalesce(NEW, OLD);
  end if;

  select p.username, p.avatar_url, p.verified
    into profile_row
  from public.profiles p
  where p.id = NEW.user_id;

  payload := jsonb_build_object(
    'id', NEW.id,
    'stream_id', NEW.stream_id,
    'user_id', NEW.user_id,
    'message', NEW.message,
    'created_at', NEW.created_at,
    'username', coalesce(profile_row.username, 'user'),
    'avatar_url', profile_row.avatar_url,
    'verified', coalesce(profile_row.verified, false)
  );

  perform realtime.send(
    payload,
    'chat_message',
    'tv:' || NEW.stream_id::text || ':chat',
    false
  );

  return NEW;
end;
$$;

drop trigger if exists stream_chat_broadcast_trigger on public.stream_chat;

create trigger stream_chat_broadcast_trigger
after insert on public.stream_chat
for each row
execute function public.broadcast_stream_chat_message();
