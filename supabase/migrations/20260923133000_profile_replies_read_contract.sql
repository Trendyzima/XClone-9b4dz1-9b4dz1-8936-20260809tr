-- Profile replies read contract: allow replies to appear on the author's public profile.
-- Applied directly to production during the profile contract reconciliation pass.
--
-- replies.user_id references auth.users, so the existing owner-only policy made
-- another user's public Replies tab return zero rows. This policy adds read access
-- according to the same public/private profile model used by profiles/posts.
create policy "replies_public_profile_read"
on public.replies
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.profiles author_profile
    where author_profile.id = replies.user_id
      and author_profile.account_status = 'active'
      and (
        author_profile.visibility = 'public'
        or author_profile.id = (select auth.uid())
        or exists (
          select 1
          from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = author_profile.id
            and f.status = 'accepted'
        )
      )
  )
);

create index if not exists replies_user_created_at_idx
on public.replies(user_id, created_at desc);
