insert into public.testagram_ad_slots (id, code, kind, floor_cpm_micros, enabled, width, height)
values
  ('testagram-iptv-overlay', 'iptv-overlay', 'feed', 50000, true, 360, 120),
  ('testagram-tv-channels', 'tv-channels', 'feed', 50000, true, 728, 120)
on conflict (code) do update set id=excluded.id, kind=excluded.kind, floor_cpm_micros=excluded.floor_cpm_micros, enabled=true, width=excluded.width, height=excluded.height;
