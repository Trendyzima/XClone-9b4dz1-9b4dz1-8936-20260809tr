-- Restore the original story-expiry offset. Keeping it at minute 0 caused it
-- to coincide with the every-minute inventory expiry job and the even-minute
-- federation worker, and did not resolve the underlying cron worker startup
-- failures. Keep the job active while the database worker issue is investigated.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'testagram-story-expiry' limit 1;
  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule := '7-59/10 * * * *');
  end if;
end;
$$;
