-- Queue worker RPCs for the server-side Novu delivery bridge.

create or replace function public.claim_notification_delivery_batch(p_limit integer default 20)
returns table(id uuid, notification_id uuid, recipient_id uuid, event_name text, payload jsonb)
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with candidates as (
    select o.id
    from public.notification_delivery_outbox o
    where o.status in ('pending','failed')
      and o.next_attempt_at <= now()
    order by o.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  )
  update public.notification_delivery_outbox o
  set status='processing', attempts=o.attempts+1, last_error=null
  from candidates c
  where o.id=c.id
  returning o.id,o.notification_id,o.recipient_id,o.event_name,o.payload;
end;
$$;

create or replace function public.complete_notification_delivery(p_id uuid)
returns void
language sql
security definer
set search_path=public
as $$
  update public.notification_delivery_outbox
  set status='sent', sent_at=now(), next_attempt_at=now()
  where id=p_id;
$$;

create or replace function public.fail_notification_delivery(p_id uuid,p_error text)
returns void
language sql
security definer
set search_path=public
as $$
  update public.notification_delivery_outbox
  set status='failed', last_error=left(coalesce(p_error,'delivery failed'),500), next_attempt_at=now() + least(interval '1 hour', interval '5 seconds' * power(2,greatest(0,attempts-1)))
  where id=p_id;
$$;

revoke all on function public.claim_notification_delivery_batch(integer) from public,anon,authenticated;
revoke all on function public.complete_notification_delivery(uuid) from public,anon,authenticated;
revoke all on function public.fail_notification_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_notification_delivery_batch(integer) to service_role;
grant execute on function public.complete_notification_delivery(uuid) to service_role;
grant execute on function public.fail_notification_delivery(uuid,text) to service_role;
