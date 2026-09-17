create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  is_private boolean not null default false,
  member_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.list_members (
  list_id uuid not null references public.lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

alter table public.lists add column if not exists member_count integer not null default 0;

create index if not exists lists_owner_updated_idx on public.lists(owner_id, updated_at desc);
create index if not exists list_members_user_idx on public.list_members(user_id, created_at desc);
create index if not exists list_members_list_idx on public.list_members(list_id, created_at desc);

alter table public.lists enable row level security;
alter table public.list_members enable row level security;

create or replace function public.can_view_list(p_list_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.lists l
    where l.id = p_list_id
      and (
        l.owner_id = p_user_id
        or not l.is_private
        or exists (select 1 from public.list_members lm where lm.list_id = l.id and lm.user_id = p_user_id)
      )
  );
$$;

revoke all on function public.can_view_list(uuid, uuid) from public;
grant execute on function public.can_view_list(uuid, uuid) to authenticated;

drop policy if exists lists_select on public.lists;
create policy lists_select on public.lists for select to authenticated
using (owner_id = (select auth.uid()) or not is_private or public.can_view_list(id, (select auth.uid())));

drop policy if exists lists_insert on public.lists;
create policy lists_insert on public.lists for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists lists_update on public.lists;
create policy lists_update on public.lists for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists lists_delete on public.lists;
create policy lists_delete on public.lists for delete to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists list_members_select on public.list_members;
create policy list_members_select on public.list_members for select to authenticated
using (public.can_view_list(list_id, (select auth.uid())));

drop policy if exists list_members_insert on public.list_members;
create policy list_members_insert on public.list_members for insert to authenticated
with check (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid())));

drop policy if exists list_members_delete on public.list_members;
create policy list_members_delete on public.list_members for delete to authenticated
using (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid())));

create or replace function public.set_list_member_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.lists
       set member_count = (select count(*) from public.list_members where list_id = new.list_id), updated_at = now()
     where id = new.list_id;
    return new;
  end if;
  update public.lists
     set member_count = (select count(*) from public.list_members where list_id = old.list_id), updated_at = now()
   where id = old.list_id;
  return old;
end;
$$;

drop trigger if exists list_member_count_aiud on public.list_members;
create trigger list_member_count_aiud after insert or delete on public.list_members
for each row execute function public.set_list_member_count();

create or replace function public.get_list_timeline(p_list_id uuid, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  u uuid := auth.uid();
  v jsonb;
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset int := greatest(0, coalesce(p_offset, 0));
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_view_list(p_list_id, u) then raise exception 'LIST_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v
  from (
    select p.id, p.author_id, p.user_id, p.body, p.content, p.created_at, p.updated_at,
           p.media_url, p.media_type, p.media_count, p.community_id,
           pr.username, pr.display_name, pr.avatar_url
      from public.posts p
      join public.list_members lm on lm.list_id = p_list_id and lm.user_id = p.author_id
      join public.profiles pr on pr.id = p.author_id
     where p.deleted_at is null
     order by p.created_at desc
     limit v_limit offset v_offset
  ) x;
  return v;
end;
$$;

revoke all on function public.get_list_timeline(uuid, integer, integer) from public;
grant execute on function public.get_list_timeline(uuid, integer, integer) to authenticated;
grant select, insert, update, delete on public.lists to authenticated;
grant select, insert, delete on public.list_members to authenticated;

update public.lists l
set member_count = (select count(*) from public.list_members lm where lm.list_id = l.id);