update public.federated_objects
set actor_uri = raw_object->'account'->>'uri'
where raw_object is not null and jsonb_typeof(raw_object->'account')='object'
  and nullif(raw_object->'account'->>'uri','') is not null
  and actor_uri is distinct from raw_object->'account'->>'uri';

insert into public.federated_actors (
  actor_uri, username, domain, display_name, bio, avatar_url, raw_actor, fetched_at, updated_at
)
select distinct on (raw_object->'account'->>'uri')
  raw_object->'account'->>'uri',
  coalesce(nullif(raw_object->'account'->>'username',''),'unknown'),
  split_part(regexp_replace(raw_object->'account'->>'uri','^https?://',''),'/',1),
  coalesce(nullif(raw_object->'account'->>'display_name',''),raw_object->'account'->>'username','unknown'),
  raw_object->'account'->>'note',
  raw_object->'account'->>'avatar',
  raw_object->'account',
  now(), now()
from public.federated_objects
where raw_object is not null and jsonb_typeof(raw_object->'account')='object'
  and nullif(raw_object->'account'->>'uri','') is not null
  and nullif(raw_object->'account'->>'uri','') like 'https://%'
order by raw_object->'account'->>'uri', published_at desc nulls last
on conflict (actor_uri) do update set
  username=excluded.username, domain=excluded.domain, display_name=excluded.display_name,
  bio=excluded.bio, avatar_url=excluded.avatar_url, raw_actor=excluded.raw_actor, updated_at=now();