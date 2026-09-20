-- Testagram first-party GIF Store.
-- Catalog metadata lives in Postgres; binary assets can be mirrored to R2 later.
create table if not exists public.gif_catalog (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  tags text[] not null default '{}',
  media_url text not null,
  preview_url text not null,
  source_url text not null,
  license text not null,
  attribution text,
  source_provider text not null default 'wikimedia_commons',
  width integer, height integer, file_size_bytes bigint,
  active boolean not null default true, featured boolean not null default false,
  usage_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gif_catalog_license_check check (license in ('CC0-1.0','Public-Domain','CC-BY-3.0','CC-BY-4.0','CC-BY-SA-4.0')),
  constraint gif_catalog_media_https check (media_url like 'https://%' and preview_url like 'https://%')
);
create index if not exists gif_catalog_category_idx on public.gif_catalog(category, featured desc, usage_count desc, created_at desc);
create index if not exists gif_catalog_active_idx on public.gif_catalog(active, featured desc, usage_count desc);
create index if not exists gif_catalog_tags_gin_idx on public.gif_catalog using gin(tags);
alter table public.gif_catalog enable row level security;
drop policy if exists "gif catalog public read active" on public.gif_catalog;
create policy "gif catalog public read active" on public.gif_catalog for select to anon, authenticated using (active = true);
revoke all on public.gif_catalog from public;
grant select on public.gif_catalog to anon, authenticated;
create or replace function public.search_gif_catalog(p_query text default null, p_category text default 'trending', p_limit integer default 30)
returns table (id uuid,title text,category text,tags text[],media_url text,preview_url text,source_url text,license text,attribution text,width integer,height integer,featured boolean,usage_count bigint)
language sql stable set search_path = '' as $$
select g.id,g.title,g.category,g.tags,g.media_url,g.preview_url,g.source_url,g.license,g.attribution,g.width,g.height,g.featured,g.usage_count
from public.gif_catalog g
where g.active=true and (coalesce(p_category,'trending')='trending' or g.category=p_category)
and (nullif(trim(coalesce(p_query,'')),'') is null or lower(g.title) like '%'||lower(trim(p_query))||'%' or exists(select 1 from unnest(g.tags) t where lower(t) like '%'||lower(trim(p_query))||'%'))
order by g.featured desc,g.usage_count desc,g.created_at desc
limit least(greatest(coalesce(p_limit,30),1),50); $$;
revoke all on function public.search_gif_catalog(text,text,integer) from public;
grant execute on function public.search_gif_catalog(text,text,integer) to anon, authenticated;
create or replace function public.record_gif_usage(p_gif_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin update public.gif_catalog set usage_count=usage_count+1,updated_at=now() where id=p_gif_id and active=true; return found; end; $$;
revoke all on function public.record_gif_usage(uuid) from public;
grant execute on function public.record_gif_usage(uuid) to anon, authenticated;
insert into public.gif_catalog (title,category,tags,media_url,preview_url,source_url,license,attribution,source_provider,width,height,file_size_bytes,featured) values
('John Wall Dance','dance',array['dance','happy','celebrate','funny'],'https://commons.wikimedia.org/wiki/Special:FilePath/Johnwalldance.gif','https://commons.wikimedia.org/wiki/Special:FilePath/Johnwalldance.gif','https://commons.wikimedia.org/wiki/File:Johnwalldance.gif','CC0-1.0','Tbom824','wikimedia_commons',410,480,215297,true),
('Scooby Doo and Daphne Dancing','dance',array['dance','funny','happy'],'https://commons.wikimedia.org/wiki/Special:FilePath/Scooby_Doo_and_Daphne_Dancing.gif','https://commons.wikimedia.org/wiki/Special:FilePath/Scooby_Doo_and_Daphne_Dancing.gif','https://commons.wikimedia.org/wiki/File:Scooby_Doo_and_Daphne_Dancing.gif','CC0-1.0','DaphandScoob2023','wikimedia_commons',177,180,1750000,true),
('Choo Choo Train Dance','dance',array['dance','celebrate','funny'],'https://commons.wikimedia.org/wiki/Special:FilePath/Choo_Choo_TRAIN_Dance_(front)_2014-12-04.gif','https://commons.wikimedia.org/wiki/Special:FilePath/Choo_Choo_TRAIN_Dance_(front)_2014-12-04.gif','https://commons.wikimedia.org/wiki/File:Choo_Choo_TRAIN_Dance_(front)_2014-12-04.gif','CC0-1.0','Asanagi','wikimedia_commons',425,526,845712,true),
('Moonwalk','dance',array['dance','cool','wow'],'https://commons.wikimedia.org/wiki/Special:FilePath/Moonwalk_2014-11-13.gif','https://commons.wikimedia.org/wiki/Special:FilePath/Moonwalk_2014-11-13.gif','https://commons.wikimedia.org/wiki/File:Moonwalk_2014-11-13.gif','CC0-1.0','Asanagi','wikimedia_commons',300,450,291000,true),
('Animation Loading','trending',array['loading','animation','reaction'],'https://commons.wikimedia.org/wiki/Special:FilePath/Animation_-_Loading1.gif','https://commons.wikimedia.org/wiki/Special:FilePath/Animation_-_Loading1.gif','https://commons.wikimedia.org/wiki/File:Animation_-_Loading1.gif','CC0-1.0',null,'wikimedia_commons',null,null,null,false),
('YouTube Loading Symbol','trending',array['loading','reaction','wait'],'https://commons.wikimedia.org/wiki/Special:FilePath/YouTube_loading_symbol_3_(transparent).gif','https://commons.wikimedia.org/wiki/Special:FilePath/YouTube_loading_symbol_3_(transparent).gif','https://commons.wikimedia.org/wiki/File:YouTube_loading_symbol_3_(transparent).gif','CC0-1.0',null,'wikimedia_commons',null,null,null,false),
('Knowledge Is Human','wow',array['wow','knowledge','reaction'],'https://commons.wikimedia.org/wiki/Special:FilePath/Knowledge_Is_Human_animated_pink_transparent_background.gif','https://commons.wikimedia.org/wiki/Special:FilePath/Knowledge_Is_Human_animated_pink_transparent_background.gif','https://commons.wikimedia.org/wiki/File:Knowledge_Is_Human_animated_pink_transparent_background.gif','CC0-1.0',null,'wikimedia_commons',null,null,null,false),
('Animation Example','funny',array['funny','reaction','animation'],'https://commons.wikimedia.org/wiki/Special:FilePath/Animexample2.gif','https://commons.wikimedia.org/wiki/Special:FilePath/Animexample2.gif','https://commons.wikimedia.org/wiki/File:Animexample2.gif','Public-Domain',null,'wikimedia_commons',null,null,null,false)
on conflict do nothing;