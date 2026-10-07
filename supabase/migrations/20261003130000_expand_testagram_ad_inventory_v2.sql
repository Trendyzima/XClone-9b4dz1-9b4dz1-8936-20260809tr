-- Expand the Testagram-owned ad inventory to every supported product surface.
-- Production uses the canonical testagram_ad_* runtime schema. This migration must not
-- depend on the retired ZenAd tables because the production migration baseline may not
-- contain the legacy ZenAd schema.
insert into public.testagram_ad_slots (id, code, kind, floor_cpm_micros, width, height)
values
  ('testagram-following-feed','following-feed','feed',50000,728,90),
  ('testagram-video-feed','video-feed','video',75000,728,405),
  ('testagram-reels','reels','video',75000,405,720),
  ('testagram-story','story','story',75000,405,720),
  ('testagram-search','search','search',50000,728,90),
  ('testagram-post-detail','post-detail','post',50000,728,90),
  ('testagram-community','community','community',50000,728,90),
  ('testagram-marketplace','marketplace','marketplace',50000,728,90),
  ('testagram-sidebar','sidebar','sidebar',50000,300,250)
on conflict (code) do update set
  id=excluded.id,
  kind=excluded.kind,
  floor_cpm_micros=excluded.floor_cpm_micros,
  width=excluded.width,
  height=excluded.height,
  enabled=true;

create index if not exists testagram_ad_slots_enabled_code_idx
  on public.testagram_ad_slots(enabled, code);
