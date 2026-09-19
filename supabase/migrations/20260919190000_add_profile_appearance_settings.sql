alter table public.profiles
  add column if not exists appearance_settings jsonb not null default '{}'::jsonb;

comment on column public.profiles.appearance_settings is
  'Owner-controlled UI appearance preferences: theme mode, preset, accent, background and radius.';
