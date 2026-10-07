create table if not exists private.identity_verification_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references private.identity_verification_sessions(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','leased','processing','succeeded','failed','dead')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  worker_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists identity_verification_jobs_queue_idx
  on private.identity_verification_jobs(state, available_at, created_at);

alter table private.identity_verification_jobs enable row level security;
revoke all on private.identity_verification_jobs from anon, authenticated;
grant select, insert, update, delete on private.identity_verification_jobs to service_role;

do $testagram$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='private' and tablename='identity_verification_jobs' and policyname='deny_direct_client_access'
  ) then
    create policy "deny_direct_client_access" on private.identity_verification_jobs
      for all to anon, authenticated using (false) with check (false);
  end if;
end $testagram$;

comment on table private.identity_verification_jobs is
  'Durable asynchronous queue for the self-owned Testagram identity engine. No external IDV provider.';
