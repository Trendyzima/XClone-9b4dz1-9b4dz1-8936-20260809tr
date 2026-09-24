alter table public.federated_custom_discovery_feeds drop constraint if exists federated_custom_discovery_feeds_mode_check;
alter table public.federated_custom_discovery_feeds add constraint federated_custom_discovery_feeds_mode_check
  check (mode in ('all','people','posts','hashtags','mentions','media','conversations','instances'));