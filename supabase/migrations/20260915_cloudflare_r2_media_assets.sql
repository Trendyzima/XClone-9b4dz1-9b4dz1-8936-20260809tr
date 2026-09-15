create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid null,
  object_key text not null unique,
  bucket text not null,
  original_name text not null,
  mime_type text not null,
  media_type text not null check (media_type in ('image','video')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  etag text,
  status text not null default 'pending' check (status in ('pending','uploaded','failed','deleted')),
  public_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_assets_user_id_idx on public.media_assets(user_id);
create index if not exists media_assets_post_id_idx on public.media_assets(post_id);
create index if not exists media_assets_status_idx on public.media_assets(status);

alter table public.media_assets enable row level security;

drop policy if exists "media assets owner select" on public.media_assets;
drop policy if exists "media assets owner insert" on public.media_assets;
drop policy if exists "media assets owner update" on public.media_assets;
drop policy if exists "media assets owner delete" on public.media_assets;

create policy "media assets owner select"
  on public.media_assets for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "media assets owner insert"
  on public.media_assets for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "media assets owner update"
  on public.media_assets for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "media assets owner delete"
  on public.media_assets for delete
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.media_assets is 'Metadata only for media stored in Cloudflare R2. Binary image/video content never belongs in Postgres.';
comment on column public.media_assets.size_bytes is 'Hard maximum: 20 MiB (20 * 1024 * 1024 bytes).';
comment on column public.media_assets.post_id is 'Application post identifier; intentionally not a foreign key because the existing post schema may vary.';
