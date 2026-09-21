-- Canonical federation reconciliation: one relationship graph plus durable inbound activity ids.
alter table public.federated_follow_relationships add column if not exists direction text not null default 'following';
update public.federated_follow_relationships set direction='following' where direction is null or direction='';
alter table public.federated_follow_relationships drop constraint if exists federated_follow_relationships_direction_check;
alter table public.federated_follow_relationships add constraint federated_follow_relationships_direction_check check (direction in ('following','follower'));
alter table public.federated_follow_relationships drop constraint if exists federated_follow_relationship_local_user_id_remote_actor_ur_key;
create unique index if not exists federated_follow_relationships_user_actor_direction_key on public.federated_follow_relationships(local_user_id,remote_actor_uri,direction);
create index if not exists federated_follow_relationships_direction_state_idx on public.federated_follow_relationships(local_user_id,direction,state);
insert into public.federated_follow_relationships(local_user_id,remote_actor_uri,direction,state,follow_activity_uri,remote_inbox_uri,delivery_state,delivery_attempts,last_error,created_at,updated_at)
select r.local_user_id,r.remote_actor_uri,case when r.relationship='follower' then 'follower' else 'following' end,case when r.state in ('active','accepted') then 'active' else 'pending' end,r.activity_id,coalesce(r.remote_inbox_url,r.remote_shared_inbox_url),case when r.state in ('active','accepted') then 'delivered' else 'failed' end,0,r.error,r.created_at,r.updated_at
from public.federated_relationships r where r.relationship in ('following','follower') and r.state in ('active','accepted')
on conflict(local_user_id,remote_actor_uri,direction) do update set state=excluded.state,follow_activity_uri=coalesce(excluded.follow_activity_uri,public.federated_follow_relationships.follow_activity_uri),remote_inbox_uri=coalesce(excluded.remote_inbox_uri,public.federated_follow_relationships.remote_inbox_uri),delivery_state=excluded.delivery_state,last_error=excluded.last_error,updated_at=now();
update public.federated_relationships set state='failed',error=coalesce(error,'Superseded by canonical federated_follow_relationships') where relationship='following' and state='pending';
create unique index if not exists activitypub_inbox_activity_id_uidx on public.activitypub_inbox((payload->>'id')) where payload ? 'id' and coalesce(payload->>'id','') <> '';
comment on table public.federated_follow_relationships is 'Canonical ActivityPub relationship graph. direction=following is local outbound follow; direction=follower is remote follower.';
