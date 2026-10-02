-- Testagram + Newsify integration: canonical cache, public read capability,
-- deduplicated sync state, and push-notification fanout metadata.
create table if not exists public.newsify_trending_items (
  id uuid primary key default gen_random_uuid(),
  newsify_item_id text not null,
  newsify_trend_id text,
  trend_title text,
  title text not null,
  excerpt text,
  detail_url text,
  source_url text,
  source_name text not null default 'Newsify',
  geo text not null default 'US',
  language text not null default 'english',
  importance_score integer,
  importance_tier integer,
  trend_traffic bigint,
  published_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  metadata jsonb not null default '{}'::jsonb,
  unique(newsify_item_id, geo, language)
);
create index if not exists newsify_trending_items_live_idx
  on public.newsify_trending_items(geo, language, expires_at, importance_score desc, published_at desc);
create index if not exists newsify_trending_items_trend_idx
  on public.newsify_trending_items(newsify_trend_id, fetched_at desc);
alter table public.newsify_trending_items enable row level security;
drop policy if exists newsify_trending_public_read on public.newsify_trending_items;
create policy newsify_trending_public_read
  on public.newsify_trending_items for select to anon, authenticated using (expires_at > now());
revoke insert, update, delete on public.newsify_trending_items from anon, authenticated;
grant select on public.newsify_trending_items to anon, authenticated;

create or replace function public.list_newsify_trending(
  p_limit integer default 20, p_geo text default 'US', p_language text default 'english'
) returns jsonb
language sql security invoker set search_path=public as $$
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(x) order by x.importance_score desc nulls last, x.published_at desc, x.id desc), '[]'::jsonb),
    'geo', coalesce(nullif(p_geo,''),'US'),
    'language', coalesce(nullif(p_language,''),'english')
  )
  from (
    select id, newsify_item_id, newsify_trend_id, trend_title, title, excerpt,
           detail_url, source_url, source_name, geo, language,
           importance_score, importance_tier, trend_traffic,
           published_at, fetched_at, updated_at, metadata
    from public.newsify_trending_items
    where expires_at > now()
      and geo = coalesce(nullif(p_geo,''),'US')
      and language = coalesce(nullif(p_language,''),'english')
    order by importance_score desc nulls last, published_at desc, id desc
    limit greatest(1, least(coalesce(p_limit,20),50))
  ) x;
$$;
revoke all on function public.list_newsify_trending(integer,text,text) from public;
grant execute on function public.list_newsify_trending(integer,text,text) to anon, authenticated;

insert into public.capability_registry(name, version, access, readonly, description, enabled)
values ('testagram.news.trending', 1, 'public', true, 'Current Newsify trending stories cached by Testagram.', true)
on conflict (name) do update set version=excluded.version, access=excluded.access, readonly=excluded.readonly,
description=excluded.description, enabled=true, updated_at=now();

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name='newsify_worker_token') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'newsify_worker_token','Internal Testagram Newsify sync worker token');
  end if;
end $$;

create or replace function public.newsify_sync_lock() returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin return pg_try_advisory_lock(hashtextextended('testagram:newsify-sync', 0)); end; $$;
revoke all on function public.newsify_sync_lock() from public, anon, authenticated;
grant execute on function public.newsify_sync_lock() to service_role;

create or replace function public.newsify_sync_unlock() returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin return pg_advisory_unlock(hashtextextended('testagram:newsify-sync', 0)); end; $$;
revoke all on function public.newsify_sync_unlock() from public, anon, authenticated;
grant execute on function public.newsify_sync_unlock() to service_role;