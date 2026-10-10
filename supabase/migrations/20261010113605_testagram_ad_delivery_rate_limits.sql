-- Public ad delivery must be rate-limited before it can claim billable inventory.
-- Store only an HMAC of the client IP, never the raw address.
create table if not exists public.testagram_ad_request_rate_limits (
  key_hash text primary key check (length(key_hash) between 32 and 128),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.testagram_ad_request_rate_limits enable row level security;
revoke all on table public.testagram_ad_request_rate_limits from public, anon, authenticated;
grant all on table public.testagram_ad_request_rate_limits to service_role;

create or replace function public.testagram_consume_ad_rate_limit(
  p_key_hash text,
  p_window_seconds integer default 60,
  p_limit integer default 60
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_key_hash is null or length(p_key_hash) < 32 or length(p_key_hash) > 128
     or p_window_seconds < 1 or p_window_seconds > 3600
     or p_limit < 1 or p_limit > 10000 then
    return false;
  end if;

  insert into public.testagram_ad_request_rate_limits as current_limit
    (key_hash, window_started_at, request_count, updated_at)
  values (p_key_hash, now(), 1, now())
  on conflict (key_hash) do update set
    request_count = case
      when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else current_limit.request_count + 1
    end,
    window_started_at = case
      when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else current_limit.window_started_at
    end,
    updated_at = now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.testagram_consume_ad_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.testagram_consume_ad_rate_limit(text, integer, integer) to service_role;
