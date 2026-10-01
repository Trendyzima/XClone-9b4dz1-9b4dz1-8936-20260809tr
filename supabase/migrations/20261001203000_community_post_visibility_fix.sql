-- Community post visibility repair.
-- The canonical visibility helper already allows active members to read
-- private-community posts. The legacy public-only RLS policy did not use it,
-- causing the community page to receive counts while the post rows were
-- filtered out.

drop policy if exists posts_public_read on public.posts;

create policy posts_public_read
on public.posts
for select
to anon, authenticated
using (
  public.testagram_post_is_visible_to_viewer(
    id,
    (select auth.uid())
  )
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
      and public.testagram_post_is_visible_to_viewer(
        p.id,
        (select auth.uid())
      )
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
      and public.testagram_post_is_visible_to_viewer(
        p.id,
        (select auth.uid())
      )
  )
);

-- Ensure the canonical read helper remains executable by both public
-- timelines and authenticated community members.
grant execute on function public.testagram_post_is_visible_to_viewer(uuid, uuid) to anon, authenticated;
