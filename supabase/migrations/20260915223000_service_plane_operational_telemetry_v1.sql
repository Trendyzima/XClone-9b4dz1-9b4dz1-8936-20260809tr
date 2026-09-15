create or replace function public.record_service_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'federation_deliveries' then
    insert into public.service_metrics(service, operation, status, duration_ms, metadata)
    values ('federation','delivery',coalesce(new.status,'unknown'),null,jsonb_build_object('delivery_id',new.id::text,'instance_domain',new.instance_domain,'http_status',new.last_status_code,'attempt_count',new.attempt_count));
  elsif tg_table_name = 'wallet_transactions' then
    insert into public.service_metrics(service, operation, status, duration_ms, metadata)
    values ('wallet','transaction',coalesce(new.status,new.provider_status,'unknown'),null,jsonb_build_object('transaction_id',new.id::text,'provider',new.provider,'kind',new.kind,'type',new.type,'direction',new.direction,'amount',new.amount,'currency',new.currency));
  end if;
  return new;
end;
$$;

revoke all on function public.record_service_event_trigger() from public;

drop trigger if exists federation_delivery_service_metrics on public.federation_deliveries;
create trigger federation_delivery_service_metrics after insert or update of status,last_status_code,attempt_count on public.federation_deliveries for each row execute function public.record_service_event_trigger();

drop trigger if exists wallet_transaction_service_metrics on public.wallet_transactions;
create trigger wallet_transaction_service_metrics after insert or update of status,provider_status,completed_at on public.wallet_transactions for each row execute function public.record_service_event_trigger();

create or replace view public.service_plane_health as
select service,
       count(*) filter (where created_at >= now() - interval '24 hours') as events_24h,
       count(*) filter (where status in ('error','failed','dead_letter','timeout','cancelled') and created_at >= now() - interval '24 hours') as failures_24h,
       round(avg(duration_ms) filter (where duration_ms is not null and created_at >= now() - interval '24 hours'))::numeric as avg_duration_ms,
       max(created_at) as last_event_at
from public.service_metrics
group by service;
