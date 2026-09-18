-- Prerequisite for the feature-complete frontend/backend migration.
-- The registry is deliberately service-role-only and every entry must carry
-- distinct forward/action and reverse/rollback keys.
create table if not exists public.backend_change_registry (
 id uuid primary key default gen_random_uuid(),
 object_kind text not null,
 object_name text not null,
 action text not null,
 action_key text not null unique,
 reverse_action text not null,
 reverse_key text not null unique,
 migration_key text not null,
 status text not null default 'active',
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(action_key<>reverse_key)
);
alter table public.backend_change_registry enable row level security;
revoke all on public.backend_change_registry from anon, authenticated;
grant select,insert,update,delete on public.backend_change_registry to service_role;

create table if not exists public.frontend_backend_contract (
 feature_key text primary key, route_pattern text not null, domain text not null,
 read_action_key text not null unique, read_reverse_key text not null unique,
 write_action_key text, write_reverse_key text unique,
 media_plane text not null default 'none', realtime boolean not null default false,
 e2ee boolean not null default false, notes text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(read_action_key<>read_reverse_key),
 check(write_action_key is null or write_action_key<>write_reverse_key)
);
alter table public.frontend_backend_contract enable row level security;
revoke all on public.frontend_backend_contract from anon, authenticated;
grant select,insert,update,delete on public.frontend_backend_contract to service_role;
