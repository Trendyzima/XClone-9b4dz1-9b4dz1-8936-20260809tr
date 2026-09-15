-- Capability-plane authorization hardening inspired by explicit capability boundaries.
-- All checks remain inside Postgres/RLS so they cannot be bypassed by a UI path.

create or replace function public.is_list_owner(p_list_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.lists l
    where l.id = p_list_id and l.owner_id = coalesce(p_user_id, auth.uid())
  );
$$;

create or replace function public.is_post_owner(p_post_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and coalesce(p.author_id, p.user_id) = coalesce(p_user_id, auth.uid())
      and p.deleted_at is null
  );
$$;

revoke all on function public.is_list_owner(uuid, uuid) from public;
revoke all on function public.is_post_owner(uuid, uuid) from public;
grant execute on function public.is_list_owner(uuid, uuid) to authenticated;
grant execute on function public.is_post_owner(uuid, uuid) to authenticated;

alter table public.list_members enable row level security;
alter table public.post_media enable row level security;

-- A member may be added/removed only by the list owner. Existing owner policies,
-- if present, are replaced by these explicit capability-boundary policies.
drop policy if exists "list_members_owner_insert" on public.list_members;
drop policy if exists "list_members_owner_delete" on public.list_members;
create policy "list_members_owner_insert" on public.list_members
  for insert to authenticated
  with check (public.is_list_owner(list_id));
create policy "list_members_owner_delete" on public.list_members
  for delete to authenticated
  using (public.is_list_owner(list_id));

-- A media row can only be attached to a post owned by the caller and must carry
-- the caller as its owner. This closes the cross-account attachment seam.
drop policy if exists "post_media_owner_insert" on public.post_media;
create policy "post_media_owner_insert" on public.post_media
  for insert to authenticated
  with check (owner_id = auth.uid() and public.is_post_owner(post_id));

drop policy if exists "post_media_owner_update" on public.post_media;
create policy "post_media_owner_update" on public.post_media
  for update to authenticated
  using (owner_id = auth.uid() and public.is_post_owner(post_id))
  with check (owner_id = auth.uid() and public.is_post_owner(post_id));

comment on function public.is_list_owner(uuid, uuid) is 'Explicit capability authorization predicate: caller owns the target list.';
comment on function public.is_post_owner(uuid, uuid) is 'Explicit capability authorization predicate: caller owns the live target post.';
