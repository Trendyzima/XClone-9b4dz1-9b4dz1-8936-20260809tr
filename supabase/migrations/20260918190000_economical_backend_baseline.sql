-- Economical Testagram backend baseline.
-- Postgres stores text/metadata only. Binary media is stored in Cloudflare R2.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  cover_url text,
  bio text,
  website_url text,
  location text,
  social_links jsonb not null default '{}'::jsonb,
  pronouns text,
  account_type text not null default 'personal' check (account_type in ('personal','creator','business','organization')),
  visibility text not null default 'public' check (visibility in ('public','followers','private')),
  protected_account boolean not null default false,
  verified_tier text,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  posts_count integer not null default 0,
  discoverable_by_username boolean not null default true,
  profile_features jsonb not null default '{}'::jsonb,
  account_status text not null default 'active' check (account_status in ('active','deactivated')),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_username_lower_idx on public.profiles(lower(username));
create index if not exists profiles_status_idx on public.profiles(account_status);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete cascade,
  content text not null default '',
  image_url text,
  video_url text,
  is_video boolean not null default false,
  is_long_form boolean not null default false,
  is_monetized boolean not null default false,
  price numeric(20,6),
  community_id uuid,
  media_urls text[] not null default '{}',
  media_count integer not null default 0,
  views_count bigint not null default 0,
  likes_count bigint not null default 0,
  reposts_count bigint not null default 0,
  replies_count bigint not null default 0,
  deleted_at timestamptz,
  edited_at timestamptz,
  edit_history jsonb not null default '[]'::jsonb,
  is_boosted boolean not null default false,
  boost_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_user_created_idx on public.posts(user_id,created_at desc);
create index if not exists posts_author_created_idx on public.posts(author_id,created_at desc);
create index if not exists posts_created_idx on public.posts(created_at desc);
create index if not exists posts_deleted_idx on public.posts(deleted_at);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null unique,
  bucket text,
  original_name text,
  post_id uuid references public.posts(id) on delete set null,
  media_url text,
  media_type text not null check (media_type in ('image','video')),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  etag text,
  status text not null default 'pending' check (status in ('pending','uploaded','failed','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_assets_owner_idx on public.media_assets(owner_id,created_at desc);
create index if not exists media_assets_post_idx on public.media_assets(post_id);
create index if not exists media_assets_status_idx on public.media_assets(status);

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  media_url text,
  media_type text,
  mime_type text,
  byte_size bigint,
  media_asset_id uuid,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique(post_id,sort_order)
);

create index if not exists post_media_post_idx on public.post_media(post_id,sort_order);
create unique index if not exists post_media_asset_uidx on public.post_media(post_id,media_asset_id) where media_asset_id is not null;

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending','accepted','rejected','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(follower_id,following_id)
);
create index if not exists follows_follower_idx on public.follows(follower_id,status);
create index if not exists follows_following_idx on public.follows(following_id,status);

create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique(post_id,user_id)
);
create index if not exists post_reactions_post_idx on public.post_reactions(post_id);
create index if not exists post_reactions_user_idx on public.post_reactions(user_id);

create table if not exists public.post_translations (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  language_code text not null,
  translated_content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(post_id,language_code)
);

create table if not exists public.post_analytics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  views bigint not null default 0,
  unique_viewers bigint not null default 0,
  engagement_rate numeric(8,5) not null default 0,
  shares bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  actor_id uuid references auth.users(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id,created_at desc);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  base_username text;
begin
  base_username := lower(regexp_replace(
    coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'preferred_username',
      case when new.phone is not null then 'user_'||right(regexp_replace(new.phone,'\\D','','g'),9)
           else split_part(coalesce(new.email,''),'@',1) end,
      'user_'||replace(new.id::text,'-','')),
    '[^a-z0-9_]+','_','g'));
  base_username := left(trim(both '_' from base_username),24);
  if char_length(base_username) < 3 then base_username := 'user_'||left(replace(new.id::text,'-',''),10); end if;
  insert into public.profiles(id,username,display_name,avatar_url)
  values(new.id,base_username,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',base_username),
    nullif(new.raw_user_meta_data->>'avatar_url',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.media_assets enable row level security;
alter table public.post_media enable row level security;
alter table public.follows enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_translations enable row level security;
alter table public.post_analytics enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_owner_read on public.profiles;
create policy profiles_owner_read on public.profiles for select to authenticated using (id=auth.uid());
drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert on public.profiles for insert to authenticated with check (id=auth.uid());
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists posts_owner_all on public.posts;
create policy posts_owner_all on public.posts for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists media_owner_all on public.media_assets;
create policy media_owner_all on public.media_assets for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());

drop policy if exists post_media_owner_all on public.post_media;
create policy post_media_owner_all on public.post_media for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());

drop policy if exists follows_owner_all on public.follows;
create policy follows_owner_all on public.follows for all to authenticated using (follower_id=auth.uid() or following_id=auth.uid()) with check (follower_id=auth.uid());

drop policy if exists reactions_owner_all on public.post_reactions;
create policy reactions_owner_all on public.post_reactions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists translations_read on public.post_translations;
create policy translations_read on public.post_translations for select to authenticated using (exists(select 1 from public.posts p where p.id=post_id and (p.user_id=auth.uid() or p.deleted_at is null)));
drop policy if exists analytics_owner on public.post_analytics;
create policy analytics_owner on public.post_analytics for all to authenticated using (exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid())) with check (exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid()));
drop policy if exists notifications_owner_read on public.notifications;
create policy notifications_owner_read on public.notifications for select to authenticated using (recipient_id=auth.uid());
drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications for update to authenticated using (recipient_id=auth.uid()) with check (recipient_id=auth.uid());

grant select,insert,update on public.profiles to authenticated;
grant select,insert,update,delete on public.posts to authenticated;
grant select,insert,update,delete on public.media_assets to authenticated;
grant select,insert,update,delete on public.post_media to authenticated;
grant select,insert,update,delete on public.follows to authenticated;
grant select,insert,update,delete on public.post_reactions to authenticated;
grant select,insert,update on public.post_translations to authenticated;
grant select,insert,update on public.post_analytics to authenticated;
grant select,update on public.notifications to authenticated;
