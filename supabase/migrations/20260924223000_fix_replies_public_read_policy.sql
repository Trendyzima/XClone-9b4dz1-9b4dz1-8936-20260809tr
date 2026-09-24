drop policy if exists "replies_public_post_read" on public.replies;
create policy "replies_public_post_read"
on public.replies
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.posts parent_post
    join public.profiles post_author
      on post_author.id = coalesce(parent_post.author_id, parent_post.user_id)
    join public.profiles reply_author
      on reply_author.id = replies.user_id
    where parent_post.id = replies.post_id
      and parent_post.deleted_at is null
      and post_author.account_status = 'active'
      and reply_author.account_status = 'active'
      and (
        post_author.visibility = 'public'
        or post_author.id = (select auth.uid())
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = post_author.id
            and f.status = 'accepted'
        )
      )
      and (
        reply_author.visibility = 'public'
        or reply_author.id = (select auth.uid())
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = reply_author.id
            and f.status = 'accepted'
        )
      )
  )
);
