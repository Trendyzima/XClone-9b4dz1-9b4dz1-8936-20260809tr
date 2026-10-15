-- A single delivery can make two bounded HTTP attempts (12 seconds each)
-- when a remote inbox rejects the modern signature. Keep each scheduled run to
-- one concurrency batch so the 60-second pg_net timeout can cover it reliably.

do $$
declare
  worker_job_id bigint;
  worker_command text;
begin
  select jobid, command
    into worker_job_id, worker_command
  from cron.job
  where jobname = 'federation-delivery-worker'
  order by jobid desc
  limit 1;

  if worker_job_id is null or worker_command is null then
    raise exception 'federation-delivery-worker cron job is missing';
  end if;

  if position('timeout_milliseconds := 15000' in worker_command) > 0 then
    worker_command := replace(worker_command, 'timeout_milliseconds := 15000', 'timeout_milliseconds := 60000');
  elsif position('timeout_milliseconds := 60000' in worker_command) = 0 then
    raise exception 'Unexpected federation worker timeout command; refusing unsafe rewrite';
  end if;

  if position('''limit'',5' in worker_command) = 0 then
    worker_command := replace(
      worker_command,
      'body := jsonb_build_object(''source'',''pg_cron'',''at'',now())',
      'body := jsonb_build_object(''source'',''pg_cron'',''at'',now(),''limit'',5)'
    );
  end if;

  if position('''limit'',5' in worker_command) = 0 then
    raise exception 'Could not safely set the federation worker batch limit';
  end if;

  perform cron.alter_job(worker_job_id, command := worker_command, active := true);
end;
$$;

-- The old worker repeatedly incremented attempt_count when abandoned claims
-- were reclaimed. These retry rows have counters far beyond the real retry
-- policy, so reset only those retry rows and preserve their last HTTP status.
update public.federation_deliveries
set attempt_count = 0,
    next_attempt_at = now(),
    last_error = 'Recovered retry counter inflated by the previous worker timeout loop; last HTTP status preserved',
    updated_at = now()
where status = 'retry'
  and attempt_count > 10
  and updated_at < now() - interval '5 minutes';

update public.activitypub_outbox o
set attempts = 0,
    next_attempt_at = now(),
    last_error = 'Recovered retry counter inflated by the previous worker timeout loop',
    updated_at = now()
where exists (
  select 1
  from public.federation_deliveries d
  join public.federated_activities a on a.id = d.activity_id
  where d.status = 'retry'
    and d.last_error like 'Recovered retry counter inflated by the previous worker timeout loop%'
    and a.uri = o.activity_id
);
