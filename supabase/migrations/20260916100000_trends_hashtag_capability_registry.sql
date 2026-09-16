-- Complete the native trends capability registry.
-- capability_dispatch already implements testagram.trends.list against the
-- canonical trending_topics table. Register it so the gateway contract,
-- database contract, and frontend client agree on the same surface.
insert into public.capability_registry(name, version, access, readonly, description) values
('testagram.trends.list',1,'authenticated',true,'Read current native Testagram trends from the canonical trending topics surface.')
on conflict (name) do update set
  version = excluded.version,
  access = excluded.access,
  readonly = excluded.readonly,
  description = excluded.description,
  enabled = true,
  updated_at = now();
