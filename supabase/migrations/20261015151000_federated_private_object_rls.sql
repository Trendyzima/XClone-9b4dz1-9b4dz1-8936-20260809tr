-- Public PostgREST reads must not bypass the private-recipient authorization path.
alter policy "federated objects public read"
  on public.federated_objects
  using (
    deleted_at is null
    and tombstone = false
    and visibility in ('public', 'unlisted')
  );

comment on policy "federated objects public read" on public.federated_objects is
  'Public PostgREST reads are limited to public and unlisted objects; private delivery is served by the authorization-aware edge feed.';
