-- Keep Fediverse home content fresh while prioritizing known-good public instances.
-- The worker is bounded to 84 instances and 12 concurrent remote requests; the
-- 120-second pg_net timeout allows the full bounded batch to finish.
do $$
declare
  worker_job_id bigint;
  worker_command text;
begin
  select jobid, command
    into worker_job_id, worker_command
  from cron.job
  where jobname = 'federation-inbound-worker'
  order by jobid desc
  limit 1;

  if worker_job_id is null or worker_command is null then
    raise exception 'federation-inbound-worker cron job is missing';
  end if;

  if position('timeout_milliseconds := 15000' in worker_command) > 0 then
    worker_command := replace(
      worker_command,
      'timeout_milliseconds := 15000',
      'timeout_milliseconds := 120000'
    );
  elsif position('timeout_milliseconds := 120000' in worker_command) = 0 then
    raise exception 'Unexpected inbound worker timeout; refusing unsafe rewrite';
  end if;

  perform cron.alter_job(
    worker_job_id,
    schedule := '*/5 * * * *',
    command := worker_command,
    active := true
  );
end;
$$;
