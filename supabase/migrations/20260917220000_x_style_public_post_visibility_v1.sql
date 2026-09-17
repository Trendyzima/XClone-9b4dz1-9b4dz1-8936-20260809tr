-- X-style public social visibility contract.
-- Public posts are discoverable; protected-account posts require an accepted follow.
-- Deleted posts and private-community posts are excluded from public timelines.

drop policy if exists posts_read on public.posts;
drop policy if exists posts_replies_read on public.posts;
drop policy if exists posts_public_read on public.posts;

create policy posts_public_read on public.posts
for select to anon, authenticated
using (
  deleted_at is null
  and (
    (
      community_id is null
      and exists (
        select 1 from public.profiles p
        where p.id = coalesce(posts.author_id, posts.user_id)
          and (
            p.protected_account = false
            or p.id = (select auth.uid())
            or exists (
              select 1 from public.follows f
              where f.follower_id = (select auth.uid())
                and f.following_id = p.id
                and f.status = 'accepted'
            )
          )
      )
    )
    or (
      community_id is not null
      and exists (
        select 1 from public.communities c
        where c.id = posts.community_id and not c.is_private
      )
    )
  )
);

drop policy if exists post_media_public_read on public.post_media;
drop policy if exists post_media_read on public.post_media;
drop policy if exists post_media_read_all on public.post_media;

create policy post_media_public_read on public.post_media
for select to anon, authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_media.post_id
      and p.deleted_at is null
      and (
        (
          p.community_id is null
          and exists (
            select 1 from public.profiles pr
            where pr.id = coalesce(p.author_id, p.user_id)
              and (
                pr.protected_account = false
                or pr.id = (select auth.uid())
                or exists (
                  select 1 from public.follows f
                  where f.follower_id = (select auth.uid())
                    and f.following_id = pr.id
                    and f.status = 'accepted'
                )
              )
          )
        )
        or (
          p.community_id is not null
          and exists (
            select 1 from public.communities c
            where c.id = p.community_id and not c.is_private
          )
        )
      )
  )
);

drop policy if exists post_replies_public_read on public.post_replies;
drop policy if exists replies_read on public.post_replies;

create policy post_replies_public_read on public.post_replies
for select to anon, authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_replies.post_id and p.deleted_at is null
  )
);
