-- Story media pipeline: metadata, batch publication, 24h expiry, and cleanup.
-- Media bytes remain outside Postgres (Cloudflare R2); this migration only owns metadata.

create table if not exists public.story_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  caption text,
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  deleted_at timestamptz
);

alter table public.story_batches enable row level security;

alter table public.stories add column if not exists batch_id uuid references public.story_batches(id) on delete cascade;
alter table public.stories add column if not exists sort_order integer not null default 0;
alter table public.stories add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.stories
set expires_at = created_at + interval '24 hours'
where expires_at is null;

create index if not exists story_batches_owner_active_idx
  on public.story_batches(owner_id, created_at desc)
  where deleted_at is null;
create index if not exists story_batches_expiry_idx
  on public.story_batches(expires_at)
  where deleted_at is null;
create index if not exists stories_active_expiry_idx
  on public.stories(expires_at)
  where deleted_at is null;
create index if not exists stories_batch_sort_idx
  on public.stories(batch_id, sort_order);
create index if not exists stories_owner_active_idx
  on public.stories(owner_id, created_at desc)
  where deleted_at is null;

drop policy if exists story_batches_owner on public.story_batches;
create policy story_batches_owner on public.story_batches
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists stories_owner on public.stories;
drop policy if exists stories_active_public on public.stories;
drop policy if exists stories_owner_insert on public.stories;
drop policy if exists stories_owner_update on public.stories;
drop policy if exists stories_owner_delete on public.stories;

create policy stories_active_public on public.stories
  for select to authenticated
  using (
    deleted_at is null
    and expires_at > now()
    and (
      owner_id = (select auth.uid())
      or visibility = 'public'
    )
  );

create policy stories_owner_insert on public.stories
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy stories_owner_update on public.stories
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy stories_owner_delete on public.stories
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.testagram_story_publish(
  p_media jsonb,
  p_caption text default null,
  p_visibility text default 'public'
) returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_user uuid := (select auth.uid());
  v_batch uuid := gen_random_uuid();
  v_expires timestamptz := now() + interval '24 hours';
  v_item jsonb;
  v_asset uuid;
  v_i integer := 0;
  v_count integer := 0;
  v_existing_owner uuid;
  v_existing_status text;
begin
  if v_user is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;

  if jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media)=0 then
    raise exception using errcode='22023', message='At least one media item is required';
  end if;

  if coalesce(p_visibility,'public') not in ('public','followers','private') then
    raise exception using errcode='22023', message='Invalid story visibility';
  end if;

  insert into public.story_batches(id,owner_id,caption,visibility,expires_at)
  values(v_batch,v_user,p_caption,coalesce(p_visibility,'public'),v_expires);

  for v_item in select value from jsonb_array_elements(p_media)
  loop
    v_i := v_i + 1;
    v_asset := null;

    if nullif(v_item->>'media_id','') is not null then
      v_asset := (v_item->>'media_id')::uuid;

      select owner_id, status into v_existing_owner, v_existing_status
      from public.media_assets
      where id=v_asset
      for update;

      if v_existing_owner is null or v_existing_owner <> v_user then
        raise exception using errcode='42501', message='Media asset is not owned by the authenticated user';
      end if;

      if v_existing_status <> 'uploaded' then
        raise exception using errcode='40901', message='Media asset is not fully uploaded';
      end if;
    else
      insert into public.media_assets(
        owner_id,storage_key,bucket,original_name,media_url,media_type,mime_type,byte_size,status
      ) values (
        v_user,
        v_item->>'storage_key',
        coalesce(v_item->>'bucket','media'),
        v_item->>'original_name',
        v_item->>'media_url',
        coalesce(v_item->>'media_type',case when coalesce(v_item->>'mime_type','') like 'video/%' then 'video' else 'image' end),
        v_item->>'mime_type',
        nullif(v_item->>'byte_size','')::bigint,
        'uploaded'
      ) returning id into v_asset;
    end if;

    insert into public.stories(
      owner_id,media_asset_id,caption,metadata,expires_at,visibility,batch_id,sort_order
    )
    values(
      v_user,v_asset,case when v_i=1 then p_caption else null end,
      coalesce(v_item->'metadata','{}'::jsonb),
      v_expires,coalesce(p_visibility,'public'),v_batch,v_i-1
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('batch_id',v_batch,'count',v_count,'expires_at',v_expires);
end;
$function$;

create or replace function public.testagram_active_stories(p_owner_id uuid default null)
returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.owner_id, s.sort_order, s.created_at), '[]'::jsonb)
  from (
    select st.id, st.owner_id, st.media_asset_id, st.caption, st.metadata,
           st.created_at, st.expires_at, st.visibility, st.batch_id, st.sort_order,
           ma.media_url, ma.media_type, ma.mime_type, ma.byte_size
    from public.stories st
    join public.media_assets ma on ma.id = st.media_asset_id
    where st.deleted_at is null
      and st.expires_at > now()
      and ma.status = 'uploaded'
      and (p_owner_id is null or st.owner_id = p_owner_id)
      and (st.owner_id = (select auth.uid()) or st.visibility = 'public')
  ) s;
$$;

create or replace function public.testagram_expire_stories()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count integer;
begin
  update public.stories
  set deleted_at=now()
  where deleted_at is null and expires_at <= now();
  get diagnostics v_count = row_count;

  update public.story_batches
  set deleted_at=now()
  where deleted_at is null and expires_at <= now();

  return v_count;
end;
$function$;

revoke execute on function public.testagram_expire_stories() from public,anon,authenticated;
grant execute on function public.testagram_expire_stories() to postgres;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if not exists (select 1 from cron.job where jobname='testagram-story-expiry') then
    perform cron.schedule('testagram-story-expiry','*/10 * * * *','select public.testagram_expire_stories();');
  end if;
end $$;
