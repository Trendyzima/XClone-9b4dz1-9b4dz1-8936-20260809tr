alter table public.profiles
  add column if not exists profile_features jsonb not null default '{"analytics":true,"monetization":true,"podcasts":true,"series":true,"achievements":true,"highlights":true,"social-links":true,"tips":true}'::jsonb;

comment on column public.profiles.profile_features is 'Owner-controlled visibility for optional profile surfaces.';
