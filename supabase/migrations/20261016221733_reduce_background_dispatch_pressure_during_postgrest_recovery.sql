-- Incident mitigation: several high-frequency HTTP dispatch jobs are failing to start
-- while PostgREST cannot rebuild its schema cache. Reduce overlapping retries until
-- the Data API is healthy, while keeping all queues enabled and staggering dispatches.
SELECT cron.alter_job(job_id := 6,  schedule := '*/2 * * * *');
SELECT cron.alter_job(job_id := 9,  schedule := '3-59/5 * * * *');
SELECT cron.alter_job(job_id := 13, schedule := '8-59/30 * * * *');
SELECT cron.alter_job(job_id := 17, schedule := '1-59/2 * * * *');
SELECT cron.alter_job(job_id := 23, schedule := '13-59/30 * * * *');
