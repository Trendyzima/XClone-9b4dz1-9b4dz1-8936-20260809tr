-- Production-safe community post visibility contract.
-- Some historical production baselines do not contain the canonical helper,
-- so provision it before policies reference it.

create or replace function public.testagram_post_is_visible_to_viewer(
  p_post_id uuid,
  p_viewer_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
select exists (
  select 1
  from public.posts p
  where p.id = p_post_id
    and p.deleted_at is null
    and p_viewer_id is not distinct from auth.uid()
    and (
      (
        p.community_id is null
        and exists (
          select 1
          from public.profiles pr
          where pr.id = coalesce(p.author_id, p.user_id)
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
      or
      (
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
                where cm.community_id = p.community_id
                  and cm.user_id = p_viewer_id
                  and cm.status = 'active'
              )
            )
        )
      )
    )
);
$$;

revoke all on function public.testagram_post_is_visible_to_viewer(uuid, uuid) from public;
grant execute on function public.testagram_post_is_visible_to_viewer(uuid, uuid) to anon, authenticated;

drop policy if exists posts_public_read on public.posts;
create policy posts_public_read
on public.posts
for select
to anon, authenticated
using (
  public.testagram_post_is_visible_to_viewer(id, (select auth.uid()))
);

drop policy if exists post_media_public_read on public.post_media;
create policy post_media_public_read
on public.post_media
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_media.post_id
      and public.testagram_post_is_visible_to_viewer(p.id, (select auth.uid()))
  )
);

drop policy if exists post_replies_public_read on public.post_replies;
create policy post_replies_public_read
on public.post_replies
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_replies.post_id
      and public.testagram_post_is_visible_to_viewer(p.id, (select auth.uid()))
  )
);