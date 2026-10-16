-- Public timeline ingestion already stores the upstream Mastodon status in raw_object.
-- Repair only rows with an explicit upstream visibility, never infer public visibility
-- from missing audience data. Mastodon "private" maps to ActivityPub followers-only.
update public.federated_objects
set visibility = case lower(raw_object->>'visibility')
  when 'private' then 'followers'
  else lower(raw_object->>'visibility')
end
where instance_id is not null
  and lower(coalesce(raw_object->>'visibility','')) in ('public','unlisted','private','followers','direct')
  and visibility is distinct from case lower(raw_object->>'visibility')
    when 'private' then 'followers'
    else lower(raw_object->>'visibility')
  end;

create index if not exists federated_objects_public_feed_cursor_idx
  on public.federated_objects (published_at desc, id desc)
  where deleted_at is null and tombstone = false and visibility in ('public','unlisted');

comment on index public.federated_objects_public_feed_cursor_idx is
  'Supports recent public/unlisted Fediverse feed pagination without scanning private objects.';
