-- Keep Fediverse storage lean without touching local Testagram content.
-- Remote objects are disposable cache unless referenced by a durable local interaction.

create or replace function public.cleanup_federation_storage()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_inbox bigint:=0; v_outbox bigint:=0; v_cache bigint:=0; v_objects bigint:=0; v_views bigint:=0;
begin
  delete from public.activitypub_inbox
    where expires_at is not null and expires_at < now() and processed=true;
  get diagnostics v_inbox=row_count;

  delete from public.activitypub_outbox
    where expires_at is not null and expires_at < now() and delivered=true;
  get diagnostics v_outbox=row_count;

  delete from public.federation_remote_cache
    where expires_at < now() or fetched_at < now()-interval '12 hours';
  get diagnostics v_cache=row_count;

  delete from public.federated_post_views
    where viewed_at < now()-interval '12 hours';
  get diagnostics v_views=row_count;

  delete from public.federated_objects fo
    where coalesce(fo.updated_at,fo.created_at) < now()-interval '12 hours'
      and not exists (select 1 from public.federated_interactions fi where fi.object_uri=fo.uri and fi.active=true)
      and not exists (select 1 from public.federated_bookmarks fb where fb.object_uri=fo.uri)
      and not exists (select 1 from public.federated_quotes fq where fq.object_uri=fo.uri)
      and not exists (select 1 from public.federated_replies fr where fr.object_uri=fo.uri)
      and not exists (select 1 from public.federated_replies fr where fr.parent_uri=fo.uri);
  get diagnostics v_objects=row_count;

  return jsonb_build_object(
    'inbox_deleted',v_inbox,'outbox_deleted',v_outbox,'cache_deleted',v_cache,
    'federated_objects_deleted',v_objects,'federated_views_deleted',v_views,
    'retention_hours',12
  );
end
$function$;

select cron.alter_job(
  2,
  schedule => '15 */12 * * *',
  command => 'select public.cleanup_federation_storage();'
);