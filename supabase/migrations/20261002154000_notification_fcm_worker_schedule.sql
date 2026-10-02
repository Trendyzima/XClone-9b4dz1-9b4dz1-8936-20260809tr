-- Keep the FCM delivery worker continuously draining the durable notification outbox.
-- The worker itself validates the bearer token and requires the FCM service-account secret.
do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'notification-delivery-worker'
  ) then
    perform cron.schedule(
      'notification-delivery-worker',
      '30 seconds',
      $job$
        select case
          when exists (
            select 1 from vault.decrypted_secrets
            where name = 'fcm_service_account_json'
          )
          then net.http_post(
            url := 'https://ffrhglgkukgsuhxenena.supabase.co/functions/v1/notification-delivery-worker',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-notification-worker-token',
                (select decrypted_secret
                 from vault.decrypted_secrets
                 where name = 'notification_worker_token')
            ),
            body := jsonb_build_object(
              'source', 'pg_cron',
              'time', now()
            ),
            timeout_milliseconds := 5000
          )
          else null
        end;
      $job$
    );
  end if;
end
$$;
