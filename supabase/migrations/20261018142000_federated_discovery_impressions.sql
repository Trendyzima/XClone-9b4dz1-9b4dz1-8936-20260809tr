-- Per-user seen tracking for the public federated discovery feed.
-- Discovery itself remains public; only authenticated viewers write impression rows.
create table if not exists public.federated_discovery_impressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  object_id uuid not null references public.federated_objects(id) on delete cascade,
  surface text not null default 'fediverse' check (length(btrim(surface)) > 0),
  shown_at timestamptz not null default now(),
  constraint federated_discovery_impressions_pkey primary key (user_id, object_id, surface)
);

create index if not exists federated_discovery_impressions_user_surface_shown_idx
  on public.federated_discovery_impressions (user_id, surface, shown_at desc);

alter table public.federated_discovery_impressions enable row level security;
revoke all on table public.federated_discovery_impressions from anon, authenticated;
grant all on table public.federated_discovery_impressions to service_role;
