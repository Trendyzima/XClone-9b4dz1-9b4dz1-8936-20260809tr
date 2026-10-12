-- Canonical inventory slot used by the native social feed.
-- Keep this in testagram_ad_slots, which zenad-decision actually queries.
insert into public.testagram_ad_slots
  (id, code, kind, floor_cpm_micros, enabled, width, height)
values
  ('testagram-feed-inline-native', 'feed-inline', 'feed', 50000, true, 640, 360)
on conflict (code) do update set
  id = excluded.id,
  kind = excluded.kind,
  floor_cpm_micros = excluded.floor_cpm_micros,
  enabled = true,
  width = excluded.width,
  height = excluded.height;
