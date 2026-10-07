-- Enforce identity-first onboarding without retaining government-ID media in Testagram storage.
-- Pre-auth registration state lives in the private schema and is never exposed through the Data API.
-- Didit receives the document images for verification; Testagram persists only the minimum
-- verification outcome and a keyed national-ID uniqueness fingerprint.

drop view if exists public.identity_verification_review_queue;

create table if not exists private.identity_signup_intents (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_otp_hash text,
  email_otp_expires_at timestamptz,
  email_verified_at timestamptz,
  registration_token_hash text not null unique,
  legal_terms_accepted_at timestamptz not null,
  legal_privacy_accepted_at timestamptz not null,
  legal_content_policy_accepted_at timestamptz not null,
  legal_age_confirmed_at timestamptz not null,
  legal_policy_version text not null,
  birth_date date not null,
  username text,
  display_name text,
  didit_session_id uuid,
  didit_status text not null default 'not_started',
  identity_status text not null default 'pending',
  id_number_hmac bytea,
  id_number_last4 text,
  country_code text not null default 'KE',
  provider_reference text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  completed_user_id uuid
);

create unique index if not exists identity_signup_intents_email_idx
  on private.identity_signup_intents(lower(email));

create unique index if not exists identity_signup_intents_id_hmac_idx
  on private.identity_signup_intents(id_number_hmac)
  where id_number_hmac is not null;

create unique index if not exists identity_signup_intents_didit_session_idx
  on private.identity_signup_intents(didit_session_id)
  where didit_session_id is not null;

alter table public.identity_verifications
  drop column if exists front_object_path,
  drop column if exists back_object_path;

create or replace view public.identity_verification_review_queue
with (security_invoker = true)
as
select iv.id, iv.user_id, iv.id_type, iv.id_number_last4, iv.country_code,
       iv.status, iv.verification_method, iv.provider, iv.provider_reference,
       iv.rejection_reason, iv.submitted_at, iv.reviewed_at, iv.reviewed_by,
       iv.email_snapshot, p.username, p.display_name
from public.identity_verifications iv
join public.profiles p on p.id = iv.user_id;

revoke all on private.identity_signup_intents from public, anon, authenticated;

comment on table private.identity_signup_intents is
  'Pre-auth registration state. No password or document media is stored. Document images remain in the verification provider only until its session is deleted.';

comment on column private.identity_signup_intents.id_number_hmac is
  'Keyed digest of the national ID number used only for uniqueness; raw ID number is never stored.';
