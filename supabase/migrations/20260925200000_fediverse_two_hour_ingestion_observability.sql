-- Enforce a real two-hour Fediverse ingestion cadence and expose truthful
-- operational telemetry for the UI/diagnostics.
create table if not exists public.fediverse_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  domains_attempted integer not null default 0,
  domains_succeeded integer not null default 0,
  domains_failed integer not null default 0,
  objects_fetched integer not null default 0,
  objects_upserted integer not null default 0,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);
alter table public.fediverse_ingestion_runs enable row level security;
revoke all on public.fediverse_ingestion_runs from anon, authenticated;
create index if not exists fediverse_ingestion_runs_started_idx
  on public.fediverse_ingestion_runs (started_at desc);

alter table public.fediverse_instance_sync_state
  add column if not exists last_attempt_at timestamptz,
  add column if not exists objects_fetched integer not null default 0,
  add column if not exists objects_upserted integer not null default 0,
  add column if not exists duration_ms integer;

-- Replace the old two-minute scheduler. The worker itself is responsible for
-- processing every due instance and scheduling the next per-instance run.
do $$
begin
  if exists(select 1 from cron.job where jobname='federation-inbound-worker') then
    perform cron.unschedule('federation-inbound-worker');
  end if;

  perform cron.schedule(
    'federation-inbound-worker',
    '0 */2 * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='federation_project_url') || '/functions/v1/federation-inbound-worker',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey',(select decrypted_secret from vault.decrypted_secrets where name='federation_publishable_key'),
          'x-federation-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='federation_worker_token')
        ),
        body := jsonb_build_object('source','pg_cron','at',now()),
        timeout_milliseconds := 15000
      );
    $job$
  );
end $$;


-- Safe read-only status RPC: the tables remain closed to direct client reads,
-- while the UI can show the last real ingestion result without exposing internals.
create or replace function public.get_fediverse_ingestion_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'last_run', coalesce((
      select jsonb_build_object(
        'id', r.id,
        'started_at', r.started_at,
        'completed_at', r.completed_at,
        'status', r.status,
        'domains_attempted', r.domains_attempted,
        'domains_succeeded', r.domains_succeeded,
        'domains_failed', r.domains_failed,
        'objects_fetched', r.objects_fetched,
        'objects_upserted', r.objects_upserted,
        'duration_ms', r.duration_ms,
        'error', r.error
      )
      from public.fediverse_ingestion_runs r
      order by r.started_at desc
      limit 1
    ), '{}'::jsonb),
    'next_scheduled_at', (
      select min(next_sync_at)
      from public.federated_instances
      where next_sync_at is not null
    )
  );
$$;
revoke all on function public.get_fediverse_ingestion_status() from public;
grant execute on function public.get_fediverse_ingestion_status() to anon, authenticated;
