-- RSS content must expire even if the ingest worker stops succeeding.
-- Retention is independent of the ingestion cadence and runs every 15 minutes.
create index if not exists testagram_rss_items_source_published_idx
  on public.testagram_rss_items (source_id, published_at desc, id desc);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'testagram-rss-retention') then
    perform cron.unschedule('testagram-rss-retention');
  end if;
  perform cron.schedule(
    'testagram-rss-retention',
    '*/15 * * * *',
    'select public.cleanup_testagram_rss_items();'
  );
end $$;

-- Immediately clear expired/over-age rows on migration application.
select public.cleanup_testagram_rss_items();
