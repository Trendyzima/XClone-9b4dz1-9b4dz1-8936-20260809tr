-- Repair remote actor identity after Mastodon-compatible timelines were ingested
-- with account.id as actor_uri. Canonical ActivityPub identity must be the HTTPS
-- actor URI; the numeric/internal account id is not an actor URI.
with canonical as (
  select
    fo.id as object_id,
    coalesce(
      nullif(fo.raw_object->'account'->>'uri',''),
      nullif(fo.raw_object->'account'->'pleroma'->>'ap_id',''),
      nullif(fo.raw_object->'account'->>'url','')
    ) as actor_uri
  from public.federated_objects fo
  where fo.raw_object is not null
    and jsonb_typeof(fo.raw_object->'account') = 'object'
)
update public.federated_objects fo
set actor_uri = c.actor_uri
from canonical c
where fo.id = c.object_id
  and c.actor_uri like 'https://%'
  and fo.actor_uri is distinct from c.actor_uri;

with accounts as (
  select distinct on (
    coalesce(
      nullif(fo.raw_object->'account'->>'uri',''),
      nullif(fo.raw_object->'account'->'pleroma'->>'ap_id',''),
      nullif(fo.raw_object->'account'->>'url','')
    )
  )
    coalesce(
      nullif(fo.raw_object->'account'->>'uri',''),
      nullif(fo.raw_object->'account'->'pleroma'->>'ap_id',''),
      nullif(fo.raw_object->'account'->>'url','')
    ) as actor_uri,
    coalesce(nullif(fo.raw_object->'account'->>'username',''),'unknown') as username,
    fo.raw_object->'account'->>'display_name' as display_name,
    fo.raw_object->'account'->>'note' as bio,
    fo.raw_object->'account'->>'avatar' as avatar_url,
    fo.raw_object->'account' as raw_actor
  from public.federated_objects fo
  where fo.raw_object is not null
    and jsonb_typeof(fo.raw_object->'account') = 'object'
    and coalesce(
      nullif(fo.raw_object->'account'->>'uri',''),
      nullif(fo.raw_object->'account'->'pleroma'->>'ap_id',''),
      nullif(fo.raw_object->'account'->>'url','')
    ) like 'https://%'
  order by
    coalesce(
      nullif(fo.raw_object->'account'->>'uri',''),
      nullif(fo.raw_object->'account'->'pleroma'->>'ap_id',''),
      nullif(fo.raw_object->'account'->>'url','')
    ),
    fo.published_at desc nulls last
)
insert into public.federated_actors (
  actor_uri, username, domain, display_name, bio, avatar_url, raw_actor, fetched_at, updated_at
)
select
  a.actor_uri,
  a.username,
  split_part(regexp_replace(a.actor_uri, '^https?://', ''), '/', 1),
  coalesce(nullif(trim(a.display_name),''), a.username),
  a.bio,
  a.avatar_url,
  a.raw_actor,
  now(),
  now()
from accounts a
on conflict (actor_uri) do update set
  username = excluded.username,
  domain = excluded.domain,
  display_name = excluded.display_name,
  bio = excluded.bio,
  avatar_url = excluded.avatar_url,
  raw_actor = excluded.raw_actor,
  fetched_at = now(),
  updated_at = now();

create index if not exists federated_objects_actor_uri_idx
  on public.federated_objects(actor_uri);
