-- Identity verification state is server-only. The browser must never reach the private schema.
revoke all on schema private from anon, authenticated;
alter table private.identity_signup_intents enable row level security;
grant usage on schema private to service_role;

grant select, insert, update, delete
on table private.identity_signup_intents
to service_role;

-- Keep the private schema inaccessible through the Data API to normal client roles.
revoke all on table private.identity_signup_intents from anon, authenticated;
