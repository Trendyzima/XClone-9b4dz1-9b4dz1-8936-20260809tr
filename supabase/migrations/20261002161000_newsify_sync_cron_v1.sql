-- Schedule Newsify ingestion through the existing Supabase Cron/pg_net plane.
-- The worker token is read from Vault at execution time and is never stored in source.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'testagram-newsify-sync') then
    perform cron.unschedule('testagram-newsify-sync');
  end if;
  perform cron.schedule(
    'testagram-newsify-sync',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='federation_project_url')
          || '/functions/v1/newsify-sync',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-newsify-sync-token',(select decrypted_secret from vault.decrypted_secrets where name='newsify_worker_token')
        ),
        body := jsonb_build_object('source','pg_cron','at',now()),
        timeout_milliseconds := 120000
      );
    $job$
  );
end $$;

-- Keep expired Newsify cache rows bounded.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'testagram-newsify-retention') then
    perform cron.unschedule('testagram-newsify-retention');
  end if;
  perform cron.schedule(
    'testagram-newsify-retention',
    '30 3 * * *',
    $retention$delete from public.newsify_trending_items where expires_at < now() - interval '7 days';$retention$
  );
end $$;