alter table private.identity_signup_intents
  add column if not exists email_otp_attempts integer not null default 0,
  add column if not exists email_otp_locked_until timestamptz,
  add column if not exists email_otp_last_sent_at timestamptz;

alter table private.identity_signup_intents
  drop constraint if exists identity_signup_intents_email_otp_attempts_check;

alter table private.identity_signup_intents
  add constraint identity_signup_intents_email_otp_attempts_check
  check (email_otp_attempts between 0 and 5);

create index if not exists identity_signup_intents_otp_lock_idx
  on private.identity_signup_intents(email_otp_locked_until)
  where email_otp_locked_until is not null;
