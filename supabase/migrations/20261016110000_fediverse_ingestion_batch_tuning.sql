-- Tune the inbound sync cadence to the smaller, observable batch.
-- 24 known-public + 2 exploratory sources at concurrency six complete below the
-- 120-second request timeout even when some remote timelines are slow.
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

  if position('timeout_milliseconds := 120000' in worker_command) = 0 then
    raise exception 'Inbound worker timeout must be 120000ms before increasing cadence';
  end if;

  perform cron.alter_job(
    worker_job_id,
    schedule := '*/2 * * * *',
    active := true
  );
end;
$$;
