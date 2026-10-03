-- Expand the Testagram-owned ad inventory to every supported product surface.
-- Idempotent: safe to apply on databases that already contain the original seed slots.

insert into public.zenad_slots (id, app_id, code, kind, floor_cpm_micros, width, height)
values
  ('testagram-following-feed','testagram','following-feed','feed',50000,728,90),
  ('testagram-video-feed','testagram','video-feed','video',75000,728,405),
  ('testagram-reels','testagram','reels','video',75000,405,720),
  ('testagram-story','testagram','story','story',75000,405,720),
  ('testagram-search','testagram','search','search',50000,728,90),
  ('testagram-post-detail','testagram','post-detail','post',50000,728,90),
  ('testagram-community','testagram','community','community',50000,728,90),
  ('testagram-marketplace','testagram','marketplace','marketplace',50000,728,90),
  ('testagram-sidebar','testagram','sidebar','sidebar',50000,300,250)
on conflict (id) do update set
  app_id=excluded.app_id,
  code=excluded.code,
  kind=excluded.kind,
  floor_cpm_micros=excluded.floor_cpm_micros,
  width=excluded.width,
  height=excluded.height,
  enabled=true;

create index if not exists zenad_slots_enabled_code_idx
  on public.zenad_slots(app_id, enabled, code);
