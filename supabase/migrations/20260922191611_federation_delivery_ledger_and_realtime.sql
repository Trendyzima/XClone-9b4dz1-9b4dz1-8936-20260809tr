-- Durable ActivityPub delivery ledger, scheduled recovery worker and realtime federation state.
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.federated_activities (
  id uuid primary key default gen_random_uuid(),
  uri text not null unique,
  activity_type text not null,
  actor_uri text,
  object_uri text,
  target_uri text,
  raw_activity jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_state text not null default 'queued',
  processing_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists federated_activities_state_idx on public.federated_activities(processing_state, created_at desc);
create index if not exists federated_activities_actor_idx on public.federated_activities(actor_uri);

create table if not exists public.federation_deliveries (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.federated_activities(id) on delete cascade,
  target_inbox text,
  instance_domain text,
  status text not null default 'pending' check (status in ('pending','in_flight','retry','delivered','dead_letter','gone','auth_failure','rate_limited')),
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  locked_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_status_code integer,
  last_error text,
  delivered_at timestamptz,
  activity_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(activity_id, target_inbox)
);
create index if not exists federation_deliveries_due_idx on public.federation_deliveries(status, next_attempt_at);
create index if not exists federation_deliveries_lock_idx on public.federation_deliveries(status, locked_at);
create index if not exists federation_deliveries_instance_idx on public.federation_deliveries(instance_domain, status);

alter table public.federated_activities enable row level security;
alter table public.federation_deliveries enable row level security;
revoke all on public.federated_activities from anon, authenticated;
revoke all on public.federation_deliveries from anon, authenticated;

alter table public.activitypub_outbox add column if not exists last_error text;
alter table public.activitypub_outbox add column if not exists updated_at timestamptz not null default now();
create index if not exists activitypub_outbox_pending_due_idx on public.activitypub_outbox(delivered, next_attempt_at, created_at);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='activitypub_inbox') then alter publication supabase_realtime add table public.activitypub_inbox; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='activitypub_outbox') then alter publication supabase_realtime add table public.activitypub_outbox; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='federated_objects') then alter publication supabase_realtime add table public.federated_objects; end if;
end $$;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name='federation_worker_token') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'federation_worker_token','Testagram ActivityPub delivery worker authentication token');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name='federation_project_url') then
    perform vault.create_secret('https://ffrhglgkukgsuhxenena.supabase.co','federation_project_url','Supabase project URL for scheduled federation delivery');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name='federation_publishable_key') then
    perform vault.create_secret('sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya','federation_publishable_key','Publishable key used only to reach the scheduled delivery Edge Function');
  end if;
end $$;

create or replace function public.verify_federation_worker_token(candidate text)
returns boolean language plpgsql security definer set search_path=public,vault as $$
declare expected text;
begin
  if candidate is null or length(candidate) < 32 then return false; end if;
  select decrypted_secret into expected from vault.decrypted_secrets where name='federation_worker_token' limit 1;
  return expected is not null and candidate=expected;
end $$;
revoke all on function public.verify_federation_worker_token(text) from public, anon, authenticated;
grant execute on function public.verify_federation_worker_token(text) to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname='federation-delivery-worker') then
    perform cron.schedule('federation-delivery-worker','30 seconds',$job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='federation_project_url') || '/functions/v1/federation-delivery-worker',
        headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='federation_publishable_key'),'x-federation-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='federation_worker_token')),
        body := jsonb_build_object('source','pg_cron','at',now()), timeout_milliseconds := 15000
      );
    $job$);
  end if;
end $$;

create or replace function public.cleanup_federation_delivery_storage()
returns jsonb language plpgsql security invoker set search_path=public as $$
declare delivered_deleted bigint:=0; activity_deleted bigint:=0;
begin
  delete from public.federation_deliveries where status in ('delivered','dead_letter','gone') and coalesce(delivered_at,created_at) < now()-interval '14 days';
  get diagnostics delivered_deleted=row_count;
  delete from public.federated_activities fa where fa.created_at < now()-interval '14 days' and not exists (select 1 from public.federation_deliveries fd where fd.activity_id=fa.id);
  get diagnostics activity_deleted=row_count;
  return jsonb_build_object('deliveries_deleted',delivered_deleted,'activities_deleted',activity_deleted);
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname='cleanup-federation-delivery-ledger') then
    perform cron.schedule('cleanup-federation-delivery-ledger','20 4 * * *','select public.cleanup_federation_delivery_storage();');
  end if;
end $$;

insert into public.federated_activities(uri,activity_type,actor_uri,object_uri,target_uri,raw_activity,received_at,processing_state)
select o.activity_id,o.activity_type,o.payload->>'actor',
  case when jsonb_typeof(o.payload->'object')='string' then o.payload->>'object' else o.payload->'object'->>'id' end,
  o.payload->>'target',o.payload,o.created_at,'queued'
from public.activitypub_outbox o where o.activity_id is not null
on conflict(uri) do nothing;

insert into public.federation_deliveries(activity_id,target_inbox,instance_domain,status,attempt_count,next_attempt_at,activity_payload)
select fa.id,null,null,'pending',coalesce(o.attempts,0),least(coalesce(o.next_attempt_at,now()),now()),fa.raw_activity
from public.federated_activities fa join public.activitypub_outbox o on o.activity_id=fa.uri
where o.delivered=false
on conflict(activity_id,target_inbox) do nothing;
