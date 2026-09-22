-- Global hashtag discovery for federated content.
-- Public ActivityPub tags are indexed independently of local hashtag follows.
alter table public.hashtags
  add column if not exists federated_post_count bigint not null default 0;

create table if not exists public.federated_hashtag_mentions (
  object_id uuid not null references public.federated_objects(id) on delete cascade,
  hashtag_id uuid not null references public.hashtags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (object_id, hashtag_id)
);

create index if not exists federated_hashtag_mentions_hashtag_idx
  on public.federated_hashtag_mentions (hashtag_id, created_at desc);

alter table public.federated_hashtag_mentions enable row level security;
drop policy if exists "federated hashtag mentions public read" on public.federated_hashtag_mentions;
create policy "federated hashtag mentions public read"
  on public.federated_hashtag_mentions for select to anon, authenticated
  using (true);
grant select on public.federated_hashtag_mentions to anon, authenticated;

create or replace function public.index_federated_object_hashtags(p_object_id uuid, p_tags jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tag_item jsonb;
  tag_value text;
  v_hashtag_id uuid;
  affected_ids uuid[] := '{}'::uuid[];
begin
  if p_object_id is null then return; end if;

  select coalesce(array_agg(hashtag_id), '{}'::uuid[])
    into affected_ids
  from public.federated_hashtag_mentions
  where object_id = p_object_id;

  delete from public.federated_hashtag_mentions where object_id = p_object_id;

  for tag_item in
    select value from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb))
  loop
    if coalesce(tag_item->>'type', '') not in ('Hashtag', 'Tag', '') then continue; end if;

    tag_value := lower(regexp_replace(btrim(coalesce(tag_item->>'name', '')), '^#+', ''));
    if tag_value !~ '^[[:alnum:]_][[:alnum:]_-]{0,63}$' then continue; end if;

    insert into public.hashtags(tag, last_used_at)
    values(tag_value, now())
    on conflict(tag) do update set last_used_at = greatest(public.hashtags.last_used_at, excluded.last_used_at)
    returning id into v_hashtag_id;

    if v_hashtag_id is null then
      select h.id into v_hashtag_id from public.hashtags h where h.tag = tag_value;
    end if;

    affected_ids := array_append(affected_ids, v_hashtag_id);
    insert into public.federated_hashtag_mentions(object_id, hashtag_id)
    values(p_object_id, v_hashtag_id)
    on conflict do nothing;
  end loop;

  update public.hashtags h
  set federated_post_count = (
    select count(*) from public.federated_hashtag_mentions m where m.hashtag_id = h.id
  )
  where h.id = any(affected_ids);
end;
$$;

revoke all on function public.index_federated_object_hashtags(uuid, jsonb) from public, anon, authenticated;

create or replace function public.sync_federated_object_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.index_federated_object_hashtags(
    new.id,
    case when new.deleted_at is null and new.tombstone = false then new.tags else '[]'::jsonb end
  );
  return new;
end;
$$;

drop trigger if exists federated_object_hashtag_index on public.federated_objects;
create trigger federated_object_hashtag_index
after insert or update of tags, deleted_at, tombstone on public.federated_objects
for each row execute function public.sync_federated_object_hashtags();

revoke all on function public.sync_federated_object_hashtags() from public, anon, authenticated;

-- Backfill all already-known federated content so discovery works immediately.
do $$
declare
  r record;
begin
  for r in
    select id, tags
    from public.federated_objects
    where deleted_at is null and tombstone = false
  loop
    perform public.index_federated_object_hashtags(r.id, r.tags);
  end loop;
end;
$$;
