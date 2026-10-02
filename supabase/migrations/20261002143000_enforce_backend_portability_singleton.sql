-- Keep the logical backend identity singleton and repair only duplicate metadata
-- accidentally created by an interrupted/replayed portability migration.

delete from public.backend_portability_identity
where id not in (
  select id
  from public.backend_portability_identity
  order by created_at asc, id asc
  limit 1
);

alter table public.backend_portability_identity
  add column if not exists singleton boolean not null default true;

create unique index if not exists backend_portability_identity_singleton_idx
  on public.backend_portability_identity(singleton)
  where singleton;

update public.backend_portability_identity
set singleton=true, updated_at=now()
where singleton is distinct from true;
