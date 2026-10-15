-- The delivery worker processes up to 20 deliveries in batches of five and
-- each remote inbox request can take 12 seconds. A 15-second pg_net caller
-- timeout abandons the worker before the batch can finish; the watchdog then
-- reclaims the same rows and increments attempt_count on every claim.
-- Give the bounded worker enough time and repair counters inflated by abandoned
-- claims so real delivery attempts can use the configured retry policy.

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
    worker_command := replace(
      worker_command,
      'timeout_milliseconds := 15000',
      'timeout_milliseconds := 60000'
    );
  elsif position('timeout_milliseconds := 60000' in worker_command) = 0 then
    raise exception 'Unexpected federation worker timeout command; refusing unsafe rewrite';
  end if;

  -- Pause new claims while the stuck in-flight set is repaired.
  perform cron.alter_job(worker_job_id, active := false);

  update public.federation_deliveries
  set status = 'retry',
      attempt_count = 0,
      locked_at = null,
      next_attempt_at = now(),
      last_error = 'Recovered abandoned claims after worker timeout correction; retry counter reset because watchdog reclaims inflated it',
      updated_at = now()
  where status = 'in_flight'
    and delivered_at is null;

  update public.activitypub_outbox o
  set attempts = 0,
      next_attempt_at = now(),
      last_error = 'Recovered abandoned claims after worker timeout correction',
      updated_at = now()
  where exists (
    select 1
    from public.federation_deliveries d
    join public.federated_activities a on a.id = d.activity_id
    where d.status = 'retry'
      and d.last_error like 'Recovered abandoned claims after worker timeout correction%'
      and a.uri = o.activity_id
  );

  perform cron.alter_job(
    worker_job_id,
    command := worker_command,
    active := true
  );
end;
$$;
