-- Testagram-owned identity: remove provider-era naming from the private signup state.
-- The old names are retained only as a compatibility bridge during rollout.

alter table private.identity_signup_intents
  add column if not exists verification_session_id uuid references private.identity_verification_sessions(id),
  add column if not exists verification_stage text;

update private.identity_signup_intents
set verification_session_id = didit_session_id::uuid
where verification_session_id is null
  and didit_session_id is not null
  and didit_session_id ~* '^[0-9a-f-]{36}$';

update private.identity_signup_intents
set verification_stage = case
  when didit_status ilike '%approved%' or didit_status ilike '%verified%' then 'approved'
  when didit_status ilike '%reject%' or didit_status ilike '%fail%' then 'rejected'
  else coalesce(didit_status, 'pending')
end
where verification_stage is null;

create index if not exists identity_signup_intents_verification_session_idx
  on private.identity_signup_intents(verification_session_id);

comment on column private.identity_signup_intents.verification_session_id is
  'Testagram-owned verification session identifier.';
comment on column private.identity_signup_intents.verification_stage is
  'Provider-neutral Testagram identity verification stage.';
