-- Testagram-owned identity engine foundation.
-- No external identity provider contract is represented here.

alter table private.identity_signup_intents
  rename column didit_session_id to verification_session_id;

alter table private.identity_signup_intents
  rename column didit_status to verification_stage;

alter table public.identity_verifications
  drop constraint if exists identity_verifications_verification_method_check;

alter table public.identity_verifications
  add constraint identity_verifications_verification_method_check
  check (verification_method in ('manual_review','self_hosted'));

alter table public.identity_verifications
  alter column provider drop not null,
  alter column provider_reference drop not null;

create table if not exists private.identity_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references private.identity_signup_intents(id) on delete cascade,
  user_id uuid,
  token_hash text not null unique,
  state text not null default 'created' check (state in ('created','capturing','processing','under_review','approved','rejected','expired','cancelled')),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists identity_verification_sessions_intent_idx
  on private.identity_verification_sessions(intent_id, created_at desc);

create table if not exists private.identity_verification_evidence (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.identity_verification_sessions(id) on delete cascade,
  kind text not null check (kind in ('id_front','id_back','selfie','liveness_video')),
  object_path text not null unique,
  sha256 text,
  mime_type text not null,
  byte_size bigint,
  state text not null default 'uploaded' check (state in ('uploaded','processing','processed','rejected','deleted')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists identity_verification_evidence_session_idx
  on private.identity_verification_evidence(session_id, kind);

create table if not exists private.identity_engine_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.identity_verification_sessions(id) on delete cascade,
  model_version text not null,
  document_valid boolean not null default false,
  ocr_confidence numeric(5,4),
  id_number_hmac bytea,
  id_number_last4 text,
  verified_birth_date date,
  liveness_score numeric(6,5),
  face_match_score numeric(6,5),
  tamper_score numeric(6,5),
  cross_document_match boolean,
  age_ok boolean,
  duplicate_ok boolean,
  decision text not null default 'pending' check (decision in ('pending','approved','rejected','manual_review')),
  rejection_reason text,
  engine_signature text not null,
  created_at timestamptz not null default now(),
  signed_at timestamptz
);

create unique index if not exists identity_engine_results_session_idx
  on private.identity_engine_results(session_id);

alter table private.identity_verification_sessions enable row level security;
alter table private.identity_verification_evidence enable row level security;
alter table private.identity_engine_results enable row level security;

revoke all on private.identity_verification_sessions from anon, authenticated;
revoke all on private.identity_verification_evidence from anon, authenticated;
revoke all on private.identity_engine_results from anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.identity_verification_sessions to service_role;
grant select, insert, update, delete on private.identity_verification_evidence to service_role;
grant select, insert, update, delete on private.identity_engine_results to service_role;
create policy "deny_direct_client_access" on private.identity_verification_sessions for all to anon, authenticated using (false) with check (false);
create policy "deny_direct_client_access" on private.identity_verification_evidence for all to anon, authenticated using (false) with check (false);
create policy "deny_direct_client_access" on private.identity_engine_results for all to anon, authenticated using (false) with check (false);
create policy "deny_direct_client_access" on private.identity_signup_intents for all to anon, authenticated using (false) with check (false);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-evidence','identity-evidence',false,10485760,array['image/jpeg','image/png','image/webp','video/webm','video/mp4'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','video/webm','video/mp4'];

comment on table private.identity_verification_sessions is 'Testagram-owned verification session state. No external identity provider.';
comment on table private.identity_verification_evidence is 'Private capture manifest; raw files live only in the private identity-evidence bucket.';
comment on table private.identity_engine_results is 'Signed output from Testagram identity engine. Client input alone can never approve an identity.';
