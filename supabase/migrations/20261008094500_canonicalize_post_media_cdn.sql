-- Testagram media delivery contract
-- Binary bytes remain in Cloudflare R2. Posts reference the Testagram-owned
-- CDN hostname so browsers never need a vendor storage URL.
update public.media_assets
set media_url = 'https://media.testagram.site/media/' ||
  array_to_string(string_to_array(storage_key, '/'), '/')
where storage_key is not null
  and status = 'uploaded'
  and media_url is distinct from (
    'https://media.testagram.site/media/' || storage_key
  );

update public.post_media pm
set media_url = ma.media_url
from public.media_assets ma
where ma.id = pm.media_asset_id
  and ma.media_url is not null
  and pm.media_url is distinct from ma.media_url;

with media_rollup as (
  select
    pm.post_id,
    array_agg(ma.media_url order by pm.sort_order nulls last, pm.id) as urls,
    count(*)::int as media_count,
    (array_agg(ma.media_url order by pm.sort_order nulls last, pm.id)
      filter (where ma.media_type = 'image'))[1] as image_url,
    (array_agg(ma.media_url order by pm.sort_order nulls last, pm.id)
      filter (where ma.media_type = 'video'))[1] as video_url
  from public.post_media pm
  join public.media_assets ma on ma.id = pm.media_asset_id
  where ma.status = 'uploaded'
    and ma.media_url is not null
  group by pm.post_id
)
update public.posts p
set
  media_urls = r.urls,
  media_count = r.media_count,
  image_url = r.image_url,
  video_url = r.video_url,
  is_video = (r.video_url is not null),
  updated_at = now()
from media_rollup r
where p.id = r.post_id;

comment on column public.media_assets.media_url is
  'Canonical Testagram CDN URL backed by Cloudflare R2; never a direct vendor storage URL.';

comment on column public.post_media.media_url is
  'Canonical Testagram CDN URL backed by Cloudflare R2.';
