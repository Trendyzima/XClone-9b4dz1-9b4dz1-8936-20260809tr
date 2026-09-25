alter table public.federated_instances
  add column if not exists software text,
  add column if not exists public_timeline_available boolean,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_error text,
  add column if not exists failure_class text,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists backoff_until timestamptz,
  add column if not exists next_sync_at timestamptz,
  add column if not exists discovered_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists federated_objects_published_at_idx on public.federated_objects (published_at desc) where deleted_at is null and tombstone = false;
create index if not exists federated_instances_next_sync_idx on public.federated_instances (next_sync_at asc nulls first);

insert into public.federated_instances(domain,base_url,provider,discovered_at,updated_at)
select x.domain,'https://'||x.domain,'activitypub',now(),now()
from (values ('fosstodon.org'),('hachyderm.io'),('mastodon.world'),('mas.to'),('mstdn.social'),('techhub.social'),('universeodon.com'),('social.coop'),('piaille.fr'),('ruhr.social'),('mathstodon.xyz'),('mastodon.bida.im'),('mastodon.social'),('mastodon.online'),('infosec.exchange')) x(domain)
on conflict(domain) do update set base_url=excluded.base_url,updated_at=now();

create or replace function public.cleanup_federation_storage() returns jsonb language plpgsql as $$
declare v_inbox bigint:=0; v_outbox bigint:=0; v_cache bigint:=0; v_objects bigint:=0; v_views bigint:=0;
begin
 delete from public.activitypub_inbox where expires_at is not null and expires_at < now() and processed=true; get diagnostics v_inbox=row_count;
 delete from public.activitypub_outbox where expires_at is not null and expires_at < now() and delivered=true; get diagnostics v_outbox=row_count;
 delete from public.federation_remote_cache where expires_at < now() or fetched_at < now()-interval '12 hours'; get diagnostics v_cache=row_count;
 delete from public.federated_post_views where viewed_at < now()-interval '12 hours'; get diagnostics v_views=row_count;
 delete from public.federated_objects fo
 where coalesce(fo.published_at,fo.updated_at,fo.created_at) < now()-interval '12 hours'
 and not exists (select 1 from public.federated_interactions fi where fi.object_uri=fo.uri and fi.active=true)
 and not exists (select 1 from public.federated_bookmarks fb where fb.object_uri=fo.uri)
 and not exists (select 1 from public.federated_quotes fq where fq.object_uri=fo.uri)
 and not exists (select 1 from public.federated_replies fr where fr.object_uri=fo.uri)
 and not exists (select 1 from public.federated_replies fr where fr.parent_uri=fo.uri);
 get diagnostics v_objects=row_count;
 return jsonb_build_object('inbox_deleted',v_inbox,'outbox_deleted',v_outbox,'cache_deleted',v_cache,'federated_objects_deleted',v_objects,'federated_views_deleted',v_views,'retention_hours',12);
end $$;

do $$ begin
 if exists(select 1 from cron.job where jobname='federation-inbound-worker') then perform cron.unschedule('federation-inbound-worker'); end if;
 perform cron.schedule('federation-inbound-worker','*/2 * * * *',$job$
 select net.http_post(
 url := (select decrypted_secret from vault.decrypted_secrets where name='federation_project_url') || '/functions/v1/federation-inbound-worker',
 headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='federation_publishable_key'),'x-federation-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='federation_worker_token')),
 body := jsonb_build_object('source','pg_cron','at',now()), timeout_milliseconds := 15000);
 $job$);
end $$;