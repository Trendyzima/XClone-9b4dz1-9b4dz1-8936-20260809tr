alter table private.identity_verification_evidence
  drop constraint if exists identity_verification_evidence_state_check;

alter table private.identity_verification_evidence
  add constraint identity_verification_evidence_state_check
  check (state in ('issued','uploaded','processing','processed','rejected','deleted'));

create index if not exists identity_verification_evidence_pending_idx
  on private.identity_verification_evidence(session_id, state, created_at);

comment on column private.identity_verification_evidence.sha256 is
  'SHA-256 of the exact uploaded object bytes, computed server-side after upload confirmation.';
