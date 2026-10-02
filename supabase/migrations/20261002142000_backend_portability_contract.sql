-- Testagram backend portability contract.
-- Non-destructive: adds only migration metadata/functions. No application rows are changed.
-- Preserve UUIDs, ActivityPub URIs and storage keys during any backend migration.

create table if not exists public.backend_portability_identity (
  id uuid primary key,
  logical_backend_id uuid not null unique,
  contract_version integer not null default 1,
  canonical_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.backend_portability_identity (
  id, logical_backend_id, contract_version, canonical_domain
)
values (
  gen_random_uuid(), gen_random_uuid(), 1, 'testagram.site'
)
on conflict do nothing;

create table if not exists public.backend_migration_runs (
  id uuid primary key default gen_random_uuid(),
  logical_backend_id uuid not null,
  source_backend_ref text not null,
  target_backend_ref text,
  mode text not null default 'dry_run'
    check (mode in ('dry_run','export','import','cutover','verify','rollback')),
  phase text not null default 'created'
    check (phase in ('created','preflight','exporting','importing','verifying','ready','cutover','rolled_back','failed')),
  status text not null default 'pending'
    check (status in ('pending','running','passed','failed','cancelled')),
  source_manifest jsonb,
  target_manifest jsonb,
  verification jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists backend_migration_runs_backend_idx
  on public.backend_migration_runs(logical_backend_id, created_at desc);

create or replace function public.backend_portability_manifest()
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_tables jsonb := '{}'::jsonb;
  r record;
  v_count bigint;
  v_logical_backend_id uuid;
  v_auth_users bigint := 0;
  v_storage_objects bigint := 0;
  v_storage_buckets bigint := 0;
  v_fk_count bigint := 0;
  v_rls_tables bigint := 0;
begin
  select logical_backend_id into v_logical_backend_id
  from public.backend_portability_identity
  order by created_at
  limit 1;

  for r in
    select table_name
    from information_schema.tables
    where table_schema='public'
      and table_type='BASE TABLE'
      and table_name not in ('backend_migration_runs')
    order by table_name
  loop
    execute format('select count(*)::bigint from public.%I', r.table_name)
      into v_count;
    v_tables := v_tables || jsonb_build_object(r.table_name, v_count);
  end loop;

  select count(*) into v_auth_users from auth.users;
  select count(*) into v_storage_objects from storage.objects;
  select count(*) into v_storage_buckets from storage.buckets;

  select count(*) into v_fk_count
  from information_schema.table_constraints
  where constraint_schema='public' and constraint_type='FOREIGN KEY';

  select count(*) into v_rls_tables
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity;

  return jsonb_build_object(
    'contract','testagram.backend-portability',
    'contract_version',1,
    'logical_backend_id',v_logical_backend_id,
    'generated_at',now(),
    'public_table_row_counts',v_tables,
    'auth_user_count',v_auth_users,
    'storage_object_count',v_storage_objects,
    'storage_bucket_count',v_storage_buckets,
    'public_foreign_key_count',v_fk_count,
    'public_rls_table_count',v_rls_tables,
    'preservation_rules',jsonb_build_array(
      'preserve all UUID primary/foreign keys exactly',
      'preserve ActivityPub actor/object/activity URIs exactly',
      'preserve media_assets.bucket and media_assets.storage_key exactly',
      'preserve auth user IDs and password hashes when using a full auth-schema migration',
      'migrate Storage bytes separately because database dumps contain storage metadata, not object bytes',
      'do not delete or overwrite the source backend during export or verification'
    )
  );
end;
$$;

revoke all on function public.backend_portability_manifest() from public;
grant execute on function public.backend_portability_manifest() to service_role;

alter table public.backend_portability_identity enable row level security;
alter table public.backend_migration_runs enable row level security;

revoke all on public.backend_portability_identity from anon, authenticated;
revoke all on public.backend_migration_runs from anon, authenticated;
grant select, insert, update on public.backend_migration_runs to service_role;
grant select on public.backend_portability_identity to service_role;

create policy "backend portability identity service role"
on public.backend_portability_identity
for all
to service_role
using (true)
with check (true);

create policy "backend migration runs service role"
on public.backend_migration_runs
for all
to service_role
using (true)
with check (true);
