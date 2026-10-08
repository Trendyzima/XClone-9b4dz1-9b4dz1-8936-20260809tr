-- Testagram first-party mail service: harden the existing durable mail queue.
-- public.mail_messages already exists in the production schema; this migration intentionally
-- does not create a competing table or rename its established columns.

do $$
begin
  if to_regclass('public.mail_messages') is null then
    raise exception 'public.mail_messages must exist before the Testagram mail service migration';
  end if;
end $$;

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
    where status in ('queued','retry')
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

create or replace function public.mail_messages_retry(p_id uuid,p_error text,p_retry boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mail_messages
  set status=case when p_retry then 'retry' else 'failed' end,
      last_error=left(p_error,2000),
      next_attempt_at=case
        when p_retry then now()+least(interval '1 hour', interval '5 seconds' * power(2,greatest(attempts-1,0)))
        else next_attempt_at
      end,
      updated_at=now()
  where id=p_id;
$$;

alter table public.mail_messages enable row level security;
revoke all on public.mail_messages from anon,authenticated;
grant select,insert,update,delete on public.mail_messages to service_role;

revoke all on function public.claim_mail_message(integer) from public,anon,authenticated;
grant execute on function public.claim_mail_message(integer) to service_role;
revoke all on function public.mail_messages_retry(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.mail_messages_retry(uuid,text,boolean) to service_role;
