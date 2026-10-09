-- Sports Hub reuses Testagram's existing RSS source pipeline and short-lived item cache.
-- Do not delete user-authored posts or comments; only imported RSS cache rows are eligible.

insert into public.testagram_rss_sources
  (profile_id, source_name, feed_url, category, country_code, language_code, enabled, refresh_minutes, next_fetch_at)
select p.id, p.display_name, v.feed_url, 'sports', v.country_code, 'en', true, 60, now() - interval '1 day'
from (values
  ('bbcsport', 'https://feeds.bbci.co.uk/sport/rss.xml', 'GB'),
  ('standardsports', 'https://www.standardmedia.co.ke/rss/sports.php', 'KE')
) as v(handle, feed_url, country_code)
join public.testagram_rss_source_profiles p on p.handle = v.handle
on conflict (feed_url) do update
set category = excluded.category,
    country_code = excluded.country_code,
    language_code = excluded.language_code,
    enabled = true,
    refresh_minutes = 60,
    next_fetch_at = least(testagram_rss_sources.next_fetch_at, now() - interval '1 day'),
    updated_at = now();

-- Imported sports headlines have a maximum three-hour lifetime; general RSS
-- content keeps the existing six-hour TTL assigned by the ingestion worker.
comment on table public.testagram_rss_items is
  'Publisher RSS cache. Sports-category rows expire after three hours; cleanup never touches user-authored posts.';

do $$
begin
  -- Reuse the existing RSS retention job instead of creating a duplicate.
  if exists (select 1 from cron.job where jobname = 'testagram-rss-retention') then
    perform cron.unschedule('testagram-rss-retention');
  end if;
  perform cron.schedule(
    'testagram-rss-retention',
    '0 */3 * * *',
    $retention$select public.cleanup_testagram_rss_items();$retention$
  );
end $$;
