-- Restore durable, privacy-preserving rate limits for the public magic-link endpoint.
-- Only keyed HMAC digests are stored; email addresses and client IPs are never persisted.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.auth_magic_link_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists auth_magic_link_rate_limits_updated_at_idx
  on private.auth_magic_link_rate_limits(updated_at);

revoke all on private.auth_magic_link_rate_limits from public, anon, authenticated, service_role;

create or replace function private.consume_magic_link_rate_bucket(
  p_bucket_key text,
  p_window_seconds integer
)
returns table(attempts integer, window_started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_started timestamptz;
begin
  if p_window_seconds not in (60, 3600) then
    raise exception 'INVALID_RATE_LIMIT_WINDOW';
  end if;

  insert into private.auth_magic_link_rate_limits as bucket (
    bucket_key, window_started_at, attempts, updated_at
  ) values (p_bucket_key, v_now, 1, v_now)
  on conflict (bucket_key) do update
    set attempts = case
          when bucket.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
          else bucket.attempts + 1
        end,
        window_started_at = case
          when bucket.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
          else bucket.window_started_at
        end,
        updated_at = v_now
  returning bucket.attempts, bucket.window_started_at into v_attempts, v_started;

  attempts := v_attempts;
  window_started_at := v_started;
  return next;
end;
$function$;

revoke all on function private.consume_magic_link_rate_bucket(text, integer) from public, anon, authenticated, service_role;

create or replace function public.consume_testagram_magic_link_rate_limit(
  p_email_hash text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_started timestamptz;
  v_email_min integer;
  v_email_min_started timestamptz;
  v_email_hour integer;
  v_email_hour_started timestamptz;
  v_ip_min integer;
  v_ip_min_started timestamptz;
  v_ip_hour integer;
  v_ip_hour_started timestamptz;
  v_limited boolean := false;
  v_retry integer := 1;
  v_reason text := null;
begin
  if p_email_hash is null or p_email_hash !~ '^[a-f0-9]{64}$'
    or (p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'INVALID_RATE_LIMIT_HASH';
  end if;

  select b.attempts, b.window_started_at into v_email_min, v_email_min_started
    from private.consume_magic_link_rate_bucket('email-minute:' || p_email_hash, 60) b;
  select b.attempts, b.window_started_at into v_email_hour, v_email_hour_started
    from private.consume_magic_link_rate_bucket('email-hour:' || p_email_hash, 3600) b;

  if v_email_min > 1 then
    v_limited := true;
    v_reason := 'email_minute';
    v_retry := greatest(v_retry, ceil(extract(epoch from (v_email_min_started + interval '1 minute' - v_now)))::integer);
  end if;
  if v_email_hour > 5 then
    v_limited := true;
    if v_reason is null then v_reason := 'email_hour'; end if;
    v_retry := greatest(v_retry, ceil(extract(epoch from (v_email_hour_started + interval '1 hour' - v_now)))::integer);
  end if;

  if p_ip_hash is not null then
    select b.attempts, b.window_started_at into v_ip_min, v_ip_min_started
      from private.consume_magic_link_rate_bucket('ip-minute:' || p_ip_hash, 60) b;
    select b.attempts, b.window_started_at into v_ip_hour, v_ip_hour_started
      from private.consume_magic_link_rate_bucket('ip-hour:' || p_ip_hash, 3600) b;

    if v_ip_min > 20 then
      v_limited := true;
      if v_reason is null then v_reason := 'ip_minute'; end if;
      v_retry := greatest(v_retry, ceil(extract(epoch from (v_ip_min_started + interval '1 minute' - v_now)))::integer);
    end if;
    if v_ip_hour > 100 then
      v_limited := true;
      if v_reason is null then v_reason := 'ip_hour'; end if;
      v_retry := greatest(v_retry, ceil(extract(epoch from (v_ip_hour_started + interval '1 hour' - v_now)))::integer);
    end if;
  end if;

  return jsonb_build_object(
    'allowed', not v_limited,
    'retry_after', greatest(1, v_retry),
    'reason', v_reason
  );
end;
$function$;

revoke all on function public.consume_testagram_magic_link_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_testagram_magic_link_rate_limit(text, text) to service_role;

do $schedule$
begin
  if not exists (select 1 from cron.job where jobname = 'auth-magic-link-rate-limit-cleanup') then
    perform cron.schedule(
      'auth-magic-link-rate-limit-cleanup',
      '23 * * * *',
      $job$delete from private.auth_magic_link_rate_limits where updated_at < now() - interval '2 days'$job$
    );
  end if;
end;
$schedule$;
