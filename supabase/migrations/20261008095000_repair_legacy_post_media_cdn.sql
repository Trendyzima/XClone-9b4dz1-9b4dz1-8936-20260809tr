-- Repair any legacy post URLs so every post media reference resolves through
-- Testagram's native CDN. The CDN fetches the bytes from Cloudflare R2.
update public.media_assets
set media_url = 'https://media.testagram.site/media/' || storage_key
where status = 'uploaded'
  and storage_key is not null
  and media_url is distinct from ('https://media.testagram.site/media/' || storage_key);

update public.post_media pm
set media_url = ma.media_url
from public.media_assets ma
where ma.id = pm.media_asset_id
  and ma.media_url is not null
  and pm.media_url is distinct from ma.media_url;

update public.posts
set
  image_url = case
    when image_url like 'https://media.testagram.site/users/%'
      then replace(image_url,'https://media.testagram.site/users/','https://media.testagram.site/media/users/')
    else image_url
  end,
  video_url = case
    when video_url like 'https://media.testagram.site/users/%'
      then replace(video_url,'https://media.testagram.site/users/','https://media.testagram.site/media/users/')
    else video_url
  end,
  media_urls = case
    when media_urls is null then null
    else array(
      select case
        when u like 'https://media.testagram.site/users/%'
          then replace(u,'https://media.testagram.site/users/','https://media.testagram.site/media/users/')
        else u
      end
      from unnest(media_urls) as u
    )
  end,
  updated_at = now()
where image_url like 'https://media.testagram.site/users/%'
   or video_url like 'https://media.testagram.site/users/%'
   or exists (
     select 1
     from unnest(coalesce(media_urls, array[]::text[])) as u
     where u like 'https://media.testagram.site/users/%'
   );
