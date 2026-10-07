-- Keep imported Fediverse objects ephemeral and self-cleaning.
-- The cleanup function enforces the 5-hour retention window and removes
-- dependent hashtag mentions before recalculating affected hashtag counts.

select cron.schedule(
  'testagram-fediverse-retention',
  '*/30 * * * *',
  $$select public.cleanup_expired_fediverse_content(interval '5 hours');$$
)
where not exists (
  select 1
  from cron.job
  where jobname = 'testagram-fediverse-retention'
);
