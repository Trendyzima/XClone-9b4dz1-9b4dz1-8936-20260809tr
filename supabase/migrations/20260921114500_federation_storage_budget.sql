-- Federation storage budget: bounded remote cache, inbox dedupe/retention, and outbox cleanup.
create table if not exists public.federation_remote_cache (
  cache_key text primary key,
  cache_type text not null check(cache_type in ('webfinger','actor','collection')),
  value jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  size_bytes integer not null default 0
);
create index if not exists federation_remote_cache_expiry_idx on public.federation_remote_cache(expires_at);
alter table public.federation_remote_cache enable row level security;
revoke all on public.federation_remote_cache from anon, authenticated;

alter table public.activitypub_inbox add column if not exists expires_at timestamptz;
alter table public.activitypub_inbox add column if not exists payload_bytes integer;
alter table public.activitypub_inbox add column if not exists activity_key text;
create unique index if not exists activitypub_inbox_activity_key_uidx on public.activitypub_inbox(activity_key) where activity_key is not null;
create index if not exists activitypub_inbox_retention_idx on public.activitypub_inbox(expires_at) where expires_at is not null;

alter table public.activitypub_outbox add column if not exists expires_at timestamptz;
alter table public.activitypub_outbox add column if not exists attempts integer not null default 0;
alter table public.activitypub_outbox add column if not exists next_attempt_at timestamptz;
create unique index if not exists activitypub_outbox_activity_id_uidx on public.activitypub_outbox(activity_id) where activity_id is not null;
create index if not exists activitypub_outbox_retry_idx on public.activitypub_outbox(next_attempt_at) where delivered=false;
create index if not exists activitypub_outbox_retention_idx on public.activitypub_outbox(expires_at) where expires_at is not null;

update public.activitypub_inbox set expires_at=coalesce(expires_at,created_at+interval '7 days'),payload_bytes=coalesce(payload_bytes,octet_length(payload::text)),activity_key=coalesce(activity_key,payload->>'id');
update public.activitypub_outbox set expires_at=coalesce(expires_at,created_at+interval '14 days'),next_attempt_at=coalesce(next_attempt_at,created_at),attempts=coalesce(attempts,0);

create or replace function public.cleanup_federation_storage() returns jsonb language plpgsql security invoker set search_path=public as $$
declare i bigint; o bigint; c bigint;
begin
 delete from public.activitypub_inbox where expires_at is not null and expires_at < now() and processed=true; get diagnostics i=row_count;
 delete from public.activitypub_outbox where expires_at is not null and expires_at < now() and delivered=true; get diagnostics o=row_count;
 delete from public.federation_remote_cache where expires_at < now(); get diagnostics c=row_count;
 return jsonb_build_object('inbox_deleted',i,'outbox_deleted',o,'cache_deleted',c);
end $$;

do $
begin
  if not exists (select 1 from cron.job where jobname='cleanup-federation-storage') then
    perform cron.schedule('cleanup-federation-storage','15 3 * * *','select public.cleanup_federation_storage();');
  end if;
end $;
