-- Canonical reply notification trigger repair.
-- The social notification trigger previously checked for the legacy
-- post_replies table name while the canonical table is public.replies.

create or replace function public.notify_social_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  recipient uuid;
  kind_name text;
  target_post uuid;
begin
  if TG_TABLE_NAME='follows' then
    recipient := new.following_id;
    kind_name := 'follow';
    target_post := null;
  elsif TG_TABLE_NAME='post_likes' then
    select author_id into recipient from posts where id = new.post_id;
    kind_name := 'like';
    target_post := new.post_id;
  elsif TG_TABLE_NAME='replies' then
    select author_id into recipient from posts where id = new.post_id;
    kind_name := 'reply';
    target_post := new.post_id;
  elsif TG_TABLE_NAME='post_reposts' then
    select author_id into recipient from posts where id = new.post_id;
    kind_name := 'repost';
    target_post := new.post_id;
  end if;

  if recipient is not null and recipient <> auth.uid() then
    insert into notifications(recipient_id, actor_id, kind, post_id)
    values(recipient, auth.uid(), kind_name, target_post);
  end if;

  return new;
end
$function$;

drop trigger if exists reply_notification on public.replies;

create trigger reply_notification
after insert on public.replies
for each row execute function public.notify_social_action();
