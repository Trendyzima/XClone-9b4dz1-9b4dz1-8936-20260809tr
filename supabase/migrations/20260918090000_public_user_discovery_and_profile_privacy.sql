-- Public user discovery + profile privacy controls.
-- Username discovery is independently controllable; protected accounts remain discoverable
-- but their protected posts stay subject to post RLS/follow semantics.

alter table public.profiles
  add column if not exists discoverable_by_username boolean not null default true;

update public.capability_registry
set access = 'public', updated_at = now()
where name in (
  'testagram.search.users',
  'testagram.search.posts',
  'testagram.search.hashtags',
  'testagram.search.communities',
  'testagram.trends.list'
);

grant execute on function public.capability_dispatch(text,jsonb) to anon;

-- Preserve the existing capability dispatcher and only relax authentication for
-- explicitly public discovery capabilities.
do $outer$
declare
  def text;
begin
  select pg_get_functiondef(p.oid)
    into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'capability_dispatch'
    and pg_get_function_identity_arguments(p.oid) = 'p_capability text, p_input jsonb';

  if def is null then
    raise exception 'capability_dispatch not found';
  end if;

  def := replace(
    def,
    'if u is null then raise exception ''AUTH_REQUIRED''; end if;',
    $gate$if u is null and p_capability not in (
      'testagram.search.users',
      'testagram.search.posts',
      'testagram.search.hashtags',
      'testagram.search.communities',
      'testagram.trends.list'
    ) then
      raise exception 'AUTH_REQUIRED';
    end if;$gate$
  );

  -- Replace the user-search predicate/output without exposing private profile
  -- settings. The public result is an explicit safe profile projection.
  def := replace(
    def,
    $old$select id,username,display_name,avatar_url,bio,(verified_tier is not null and verified_tier <> 'none') as verified,follower_count as followers_count
        from public.profiles
        where username ilike '%'||v_text||'%' or display_name ilike '%'||v_text||'%' or bio ilike '%'||v_text||'%'
        order by follower_count desc nulls last,username$old$,
    $new$select id,username,display_name,avatar_url,bio,
          (verified_tier is not null and verified_tier <> 'none') as verified,
          follower_count as followers_count,
          protected_account as is_protected
        from public.profiles
        where discoverable_by_username = true
          and (username ilike '%'||v_text||'%' or display_name ilike '%'||v_text||'%' or bio ilike '%'||v_text||'%')
        order by follower_count desc nulls last,username$new$
  );

  execute def;
end $outer$;


-- Keep anonymous public reads independent of authenticated-only community membership helpers.
-- This prevents the public discovery path from requiring EXECUTE on security-definer
-- membership functions and preserves private-community isolation.
drop policy if exists communities_public_or_member_read on public.communities;
drop policy if exists communities_public_read on public.communities;
drop policy if exists communities_authenticated_read on public.communities;
create policy communities_public_read on public.communities
  for select to anon
  using (is_private = false);
create policy communities_authenticated_read on public.communities
  for select to authenticated
  using (
    is_private = false
    or created_by = (select auth.uid())
    or owner_id = (select auth.uid())
    or exists (
      select 1
      from public.community_members cm
      where cm.community_id = communities.id
        and cm.user_id = (select auth.uid())
        and cm.status = 'active'
    )
  );

drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts
  for select to anon, authenticated
  using (
    deleted_at is null
    and (
      (
        community_id is null
        and exists (
          select 1
          from public.profiles pr
          where pr.id = coalesce(posts.author_id, posts.user_id)
            and (
              pr.protected_account = false
              or pr.id = (select auth.uid())
              or exists (
                select 1
                from public.follows f
                where f.follower_id = (select auth.uid())
                  and f.following_id = pr.id
                  and f.status = 'accepted'
              )
            )
        )
      )
      or (
        community_id is not null
        and exists (
          select 1
          from public.communities c
          where c.id = posts.community_id
            and c.is_private = false
        )
      )
    )
  );

-- Canonical social visibility helpers
-- One database predicate is shared by public feeds, profile timelines, search and
-- recommendation reads. It intentionally returns only whether a post may cross
-- the public social boundary for the current viewer.
create or replace function public.testagram_post_is_visible_to_viewer(
  p_post_id uuid,
  p_viewer_id uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and p.deleted_at is null
      and (
        (
          p.community_id is null
          and exists (
            select 1
            from public.profiles pr
            where pr.id = coalesce(p.author_id,p.user_id)
              and (
                pr.protected_account = false
                or pr.id = p_viewer_id
                or exists (
                  select 1
                  from public.follows f
                  where f.follower_id = p_viewer_id
                    and f.following_id = pr.id
                    and f.status = 'accepted'
                )
              )
          )
        )
        or (
          p.community_id is not null
          and exists (
            select 1
            from public.communities c
            where c.id = p.community_id
              and (
                c.is_private = false
                or exists (
                  select 1
                  from public.community_members cm
                  where cm.community_id = c.id
                    and cm.user_id = p_viewer_id
                    and cm.status = 'active'
                )
              )
          )
        )
      )
  );
$fn$;

revoke all on function public.testagram_post_is_visible_to_viewer(uuid,uuid) from public;
grant execute on function public.testagram_post_is_visible_to_viewer(uuid,uuid) to anon, authenticated;

-- Apply the canonical predicate to all existing public post visibility paths.
drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts
for select to anon, authenticated
using (public.testagram_post_is_visible_to_viewer(id, auth.uid()));
