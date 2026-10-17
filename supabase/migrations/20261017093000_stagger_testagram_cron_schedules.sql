-- Keep background cron work from competing for the small shared PostgreSQL
-- background-worker pool. Several independent jobs previously started on the
-- same minute, and cron.job_run_details recorded repeated "job startup timeout"
-- failures across unrelated services while Auth queries were timing out.
--
-- This migration changes schedules only; it does not drop data or disable jobs.
-- The high-frequency delivery/expiry jobs remain active, with one-minute offsets
-- distributed to reduce simultaneous worker startup.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'testagram-story-expiry' limit 1;
  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule := '0-59/10 * * * *');
  end if;

  select jobid into v_job_id from cron.job where jobname = 'testagram-rss-retention' limit 1;
  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule := '4-59/5 * * * *');
  end if;

  select jobid into v_job_id from cron.job where jobname = 'testagram-rss-ingest' limit 1;
  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule := '5-59/30 * * * *');
  end if;

  select jobid into v_job_id from cron.job where jobname = 'fediverse-content-retention' limit 1;
  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule := '10-59/30 * * * *');
  end if;
end;
$$;
