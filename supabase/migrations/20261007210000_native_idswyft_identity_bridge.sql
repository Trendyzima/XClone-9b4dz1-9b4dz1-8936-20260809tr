-- Native Idswyft verification replaces hosted-provider document storage.
-- Testagram keeps only the irreversible identity fingerprint and decision.

alter table public.identity_verifications
  alter column front_object_path drop not null,
  alter column back_object_path drop not null;

alter table public.identity_verifications
  drop constraint if exists identity_verifications_verification_method_check;

alter table public.identity_verifications
  add constraint identity_verifications_verification_method_check
  check (verification_method in ('manual_review','provider','self_hosted'));

create index if not exists identity_verifications_provider_reference_idx
  on public.identity_verifications(provider, provider_reference)
  where provider is not null and provider_reference is not null;

comment on column public.identity_verifications.front_object_path is
  'Optional legacy/manual-review object path. Native Idswyft verification keeps raw documents outside Testagram.';

comment on column public.identity_verifications.back_object_path is
  'Optional legacy/manual-review object path. Native Idswyft verification keeps raw documents outside Testagram.';
