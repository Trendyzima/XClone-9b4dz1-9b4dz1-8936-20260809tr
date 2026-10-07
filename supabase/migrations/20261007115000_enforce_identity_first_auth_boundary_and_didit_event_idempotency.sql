-- Enforce identity-first creation at the Auth boundary and make Didit webhook delivery idempotent.
-- Only the server-side identity-signup function marks an auth user as approved for creation.
create or replace function private.enforce_identity_first_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'testagram_identity_verified', 'false') <> 'true' then
    raise exception 'IDENTITY_VERIFICATION_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_identity_first_auth_user() from public, anon, authenticated, service_role;

drop trigger if exists auth_users_identity_first_gate on auth.users;
create trigger auth_users_identity_first_gate
before insert on auth.users
for each row
execute function private.enforce_identity_first_auth_user();

create unique index if not exists identity_verification_events_provider_event_id_uidx
on public.identity_verification_events(provider_event_id)
where provider_event_id is not null;
