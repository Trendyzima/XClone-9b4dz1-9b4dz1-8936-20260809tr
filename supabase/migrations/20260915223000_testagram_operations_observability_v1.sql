create table if not exists public.service_metrics (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  operation text not null,
  status text not null check (status in ('ok','error','timeout','degraded')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists service_metrics_service_created_idx on public.service_metrics(service, created_at desc);
create index if not exists service_metrics_status_created_idx on public.service_metrics(status, created_at desc);

alter table public.service_metrics enable row level security;
drop policy if exists service_metrics_select_own on public.service_metrics;
create policy service_metrics_select_own on public.service_metrics for select to authenticated
  using ((metadata->>'user_id') = (select auth.uid())::text);
drop policy if exists service_metrics_insert_own on public.service_metrics;
create policy service_metrics_insert_own on public.service_metrics for insert to authenticated
  with check ((metadata->>'user_id') = (select auth.uid())::text);

grant select, insert on public.service_metrics to authenticated;

create or replace function public.record_service_metric(
  p_service text,
  p_operation text,
  p_status text,
  p_duration_ms integer default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_service is null or length(trim(p_service)) = 0 or length(p_service) > 80 then raise exception 'invalid service'; end if;
  if p_operation is null or length(trim(p_operation)) = 0 or length(p_operation) > 120 then raise exception 'invalid operation'; end if;
  if p_status not in ('ok','error','timeout','degraded') then raise exception 'invalid status'; end if;
  insert into public.service_metrics(service, operation, status, duration_ms, metadata)
  values (trim(p_service), trim(p_operation), p_status, p_duration_ms,
          coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('user_id', auth.uid()::text))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_service_metric(text,text,text,integer,jsonb) from public;
grant execute on function public.record_service_metric(text,text,text,integer,jsonb) to authenticated;

create or replace view public.service_health_24h as
select service,
       count(*) as events,
       count(*) filter (where status = 'ok') as ok_events,
       count(*) filter (where status = 'error') as error_events,
       count(*) filter (where status = 'timeout') as timeout_events,
       round(avg(duration_ms))::integer as avg_duration_ms,
       max(created_at) as last_seen
from public.service_metrics
where created_at >= now() - interval '24 hours'
group by service;

revoke all on public.service_health_24h from public;
revoke all on public.service_health_24h from authenticated;
