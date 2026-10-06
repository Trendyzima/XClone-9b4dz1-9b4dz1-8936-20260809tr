-- Harden ActivityPub local publishing: when a remote follower is accepted,
-- enqueue recent public Create activities to that follower and provide a
-- service-only reconciliation path for missed deliveries.

create or replace function public.enqueue_existing_local_posts_for_follower()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_activity record;
begin
  if new.direction <> 'follower'
     or new.state not in ('accepted','active')
     or new.remote_inbox_uri is null then
    return new;
  end if;

  for v_activity in
    select fa.id, fa.raw_activity
    from public.federated_activities fa
    join public.activitypub_outbox ao on ao.activity_id=fa.uri
    where ao.local_user_id=new.local_user_id
      and fa.activity_type='Create'
      and ao.delivered=false
      and ao.created_at >= now()-interval '14 days'
    order by ao.created_at desc
    limit 50
  loop
    insert into public.federation_deliveries(
      activity_id,target_inbox,instance_domain,status,attempt_count,next_attempt_at,activity_payload
    )
    values(
      v_activity.id,
      new.remote_inbox_uri,
      lower(split_part(regexp_replace(new.remote_inbox_uri,'^https?://',''), '/', 1)),
      'pending',0,now(),v_activity.raw_activity
    )
    on conflict(activity_id,target_inbox) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_existing_local_posts_for_follower
  on public.federated_follow_relationships;

create trigger trg_enqueue_existing_local_posts_for_follower
after insert or update of state,delivery_state,remote_inbox_uri
on public.federated_follow_relationships
for each row execute function public.enqueue_existing_local_posts_for_follower();

create or replace function public.reconcile_local_federation_deliveries()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_count bigint:=0;
begin
  insert into public.federation_deliveries(
    activity_id,target_inbox,instance_domain,status,attempt_count,next_attempt_at,activity_payload
  )
  select fa.id,
         f.remote_inbox_uri,
         lower(split_part(regexp_replace(f.remote_inbox_uri,'^https?://',''), '/', 1)),
         'pending',0,now(),fa.raw_activity
  from public.federated_follow_relationships f
  join public.activitypub_actors aa on aa.user_id=f.local_user_id
  join public.federated_activities fa
    on fa.actor_uri=aa.actor_id and fa.activity_type='Create'
  join public.activitypub_outbox ao
    on ao.activity_id=fa.uri and ao.delivered=false
  where f.direction='follower'
    and f.state in ('accepted','active')
    and f.delivery_state in ('delivered','queued','pending')
    and f.remote_inbox_uri is not null
    and ao.created_at >= now()-interval '14 days'
  on conflict(activity_id,target_inbox) do nothing;

  get diagnostics v_count=row_count;
  return jsonb_build_object('deliveries_created',v_count);
end;
$$;

revoke all on function public.enqueue_existing_local_posts_for_follower() from public,anon,authenticated;
revoke all on function public.reconcile_local_federation_deliveries() from public,anon,authenticated;
grant execute on function public.reconcile_local_federation_deliveries() to service_role;