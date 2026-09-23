-- Public interaction read contracts for independent likes/reposts/quote-like pages.
create policy "post_reactions_public_read"
on public.post_reactions
for select
to anon, authenticated
using (
  exists (
    select 1 from public.posts p
    join public.profiles author_profile on author_profile.id = coalesce(p.author_id,p.user_id)
    where p.id = post_reactions.post_id
      and p.deleted_at is null
      and author_profile.account_status = 'active'
      and (
        author_profile.visibility = 'public'
        or author_profile.id = (select auth.uid())
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = author_profile.id
            and f.status = 'accepted'
        )
      )
  )
);

create policy "reposts_public_read"
on public.reposts
for select
to anon, authenticated
using (
  exists (
    select 1 from public.posts p
    join public.profiles author_profile on author_profile.id = coalesce(p.author_id,p.user_id)
    where p.id = reposts.post_id
      and p.deleted_at is null
      and author_profile.account_status = 'active'
      and (
        author_profile.visibility = 'public'
        or author_profile.id = (select auth.uid())
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = author_profile.id
            and f.status = 'accepted'
        )
      )
  )
);

create index if not exists post_reactions_post_created_idx
on public.post_reactions(post_id,created_at desc);
