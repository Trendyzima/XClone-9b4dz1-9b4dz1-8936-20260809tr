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

drop policy if exists "media assets owner select" on public.media_assets;
drop policy if exists "media assets owner insert" on public.media_assets;
drop policy if exists "media assets owner update" on public.media_assets;
drop policy if exists "media assets owner delete" on public.media_assets;

-- Relational attachment: Supabase stores the post/media relationship and metadata;
-- Cloudflare R2 stores the binary object itself.
alter table public.post_media add column if not exists media_asset_id uuid;

create unique index if not exists post_media_post_asset_uidx
  on public.post_media(post_id, media_asset_id)
  where media_asset_id is not null;

alter table public.post_media
  drop constraint if exists post_media_media_asset_id_fkey;
alter table public.post_media
  add constraint post_media_media_asset_id_fkey
  foreign key (media_asset_id) references public.media_assets(id) on delete set null;

create or replace function public.sync_r2_media_to_post_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_order smallint;
begin
  if new.status = 'uploaded' and new.post_id is not null then
    -- Serialize ordering per post so the existing post_id/sort_order uniqueness
    -- constraint remains valid when several media objects finish together.
    perform pg_advisory_xact_lock(hashtextextended(new.post_id::text, 0));
    select coalesce(max(sort_order) + 1, 0)::smallint
      into next_order
      from public.post_media
      where post_id = new.post_id;

    insert into public.post_media (
      post_id, owner_id, media_url, media_type, mime_type, byte_size, media_asset_id, sort_order
    )
    values (
      new.post_id, new.owner_id, new.media_url, new.media_type, new.mime_type, new.byte_size, new.id, next_order
    )
    on conflict (post_id, media_asset_id) where media_asset_id is not null
    do update set
      media_url = excluded.media_url,
      media_type = excluded.media_type,
      mime_type = excluded.mime_type,
      byte_size = excluded.byte_size;
  end if;
  return new;
end;
$$;

drop trigger if exists media_assets_sync_post_media on public.media_assets;
create trigger media_assets_sync_post_media
after insert or update of status, post_id, media_url, media_type, mime_type, byte_size
on public.media_assets
for each row execute function public.sync_r2_media_to_post_media();

comment on table public.media_assets is 'Metadata only for media stored in Cloudflare R2. Binary image/video content is not stored in Postgres.';
comment on column public.media_assets.byte_size is 'Hard maximum: 20 MiB (20 * 1024 * 1024 bytes).';
comment on column public.media_assets.post_id is 'Application post identifier; nullable until media is attached to a post.';
comment on column public.post_media.media_asset_id is 'Cloudflare R2-backed media_assets record; binary content remains in R2.';
