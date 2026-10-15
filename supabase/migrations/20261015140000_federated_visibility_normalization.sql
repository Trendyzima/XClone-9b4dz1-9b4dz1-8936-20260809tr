-- Persist normalized ActivityPub audience visibility for consistent local rendering.
alter table public.federated_objects
  add column if not exists visibility text not null default 'public';

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
