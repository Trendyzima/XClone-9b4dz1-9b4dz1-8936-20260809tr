-- Persist normalized ActivityPub audience visibility for consistent local rendering.
-- Unknown/recipient-less objects default to direct so incomplete metadata cannot
-- accidentally publish a private remote post into shared discovery.
alter table public.federated_objects
  add column if not exists visibility text not null default 'direct';

with audiences as (
  select
    id,
    case
      when jsonb_typeof(raw_object->'to') = 'array' then raw_object->'to'
      when raw_object ? 'to' then jsonb_build_array(raw_object->'to')
      else '[]'::jsonb
    end as to_recipients,
    case
      when jsonb_typeof(raw_object->'cc') = 'array' then raw_object->'cc'
      when raw_object ? 'cc' then jsonb_build_array(raw_object->'cc')
      else '[]'::jsonb
    end as cc_recipients
  from public.federated_objects
  where raw_object is not null
)
update public.federated_objects as object
set visibility = case
  when lower(object.raw_object->>'visibility') = 'private' then 'followers'
  when lower(object.raw_object->>'visibility') in ('public', 'unlisted', 'followers', 'direct')
    then lower(object.raw_object->>'visibility')
  when exists (
    select 1 from jsonb_array_elements(audiences.to_recipients) recipient
    where coalesce(recipient->>'id', recipient->>'@id', recipient->>'href', recipient#>>'{}')
      = 'https://www.w3.org/ns/activitystreams#Public'
  ) then 'public'
  when exists (
    select 1 from jsonb_array_elements(audiences.cc_recipients) recipient
    where coalesce(recipient->>'id', recipient->>'@id', recipient->>'href', recipient#>>'{}')
      = 'https://www.w3.org/ns/activitystreams#Public'
  ) then 'unlisted'
  when exists (
    select 1
    from (
      select recipient from jsonb_array_elements(audiences.to_recipients) recipient
      union all
      select recipient from jsonb_array_elements(audiences.cc_recipients) recipient
    ) recipients
    where regexp_replace(
      coalesce(recipients.recipient->>'id', recipients.recipient->>'@id',
               recipients.recipient->>'href', recipients.recipient#>>'{}'),
      '[?#].*$', ''
    ) ~ '/followers/?$'
  ) then 'followers'
  else 'direct'
end
from audiences
where audiences.id = object.id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'federated_objects_visibility_check'
      and conrelid = 'public.federated_objects'::regclass
  ) then
    alter table public.federated_objects
      add constraint federated_objects_visibility_check
      check (visibility in ('public', 'unlisted', 'followers', 'direct'));
  end if;
end $$;

comment on column public.federated_objects.visibility is
  'Normalized ActivityStreams audience: public, unlisted, followers, or direct.';
