-- Cloudflare R2 media metadata. The existing media_assets table is preserved.
alter table public.media_assets add column if not exists bucket text;
alter table public.media_assets add column if not exists original_name text;
alter table public.media_assets add column if not exists post_id uuid;
alter table public.media_assets add column if not exists etag text;
alter table public.media_assets add column if not exists status text not null default 'pending';
alter table public.media_assets add column if not exists updated_at timestamptz not null default now();

alter table public.media_assets drop constraint if exists media_assets_status_check;
alter table public.media_assets add constraint media_assets_status_check
  check (status in ('pending','uploaded','failed','deleted'));

-- Existing records represent already-created media and are therefore considered uploaded.
update public.media_assets
set status = 'uploaded', updated_at = coalesce(updated_at, created_at)
where status = 'pending' and byte_size > 0;

create index if not exists media_assets_post_id_idx on public.media_assets(post_id);
create index if not exists media_assets_status_idx on public.media_assets(status);

alter table public.media_assets enable row level security;

-- The project already has owner-scoped policies; remove only duplicate policy names
-- introduced by earlier versions of this migration.
drop policy if exists "media assets owner select" on public.media_assets;
drop policy if exists "media assets owner insert" on public.media_assets;
drop policy if exists "media assets owner update" on public.media_assets;
drop policy if exists "media assets owner delete" on public.media_assets;

comment on table public.media_assets is 'Metadata only for media stored in Cloudflare R2. Binary image/video content is not stored in Postgres.';
comment on column public.media_assets.byte_size is 'Hard maximum: 20 MiB (20 * 1024 * 1024 bytes).';
comment on column public.media_assets.post_id is 'Application post identifier; nullable because the existing post schema varies.';
