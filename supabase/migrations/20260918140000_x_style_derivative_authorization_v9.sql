-- X-style derivative authorization hardening v9
-- Align direct table access with the canonical post/profile visibility boundary.

drop policy if exists follows_public_read on public.follows;
create policy follows_public_read on public.follows
for select to anon, authenticated
using (
  status='accepted'
  and exists (
    select 1 from public.profiles follower
    where follower.id=follows.follower_id
      and (
        follower.protected_account=false
        or follower.id=auth.uid()
        or exists (
          select 1 from public.follows af
          where af.follower_id=auth.uid()
            and af.following_id=follower.id
            and af.status='accepted'
        )
      )
  )
  and exists (
    select 1 from public.profiles following
    where following.id=follows.following_id
      and (
        following.protected_account=false
        or following.id=auth.uid()
        or exists (
          select 1 from public.follows af
          where af.follower_id=auth.uid()
            and af.following_id=following.id
            and af.status='accepted'
        )
      )
  )
);

drop policy if exists replies_public_read on public.replies;
create policy replies_public_read on public.replies
for select to anon, authenticated
using (public.testagram_post_is_visible_to_viewer(post_id,auth.uid()));

drop policy if exists replies_authenticated_insert on public.replies;
create policy replies_authenticated_insert on public.replies
for insert to authenticated
with check (
  user_id=auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id,auth.uid())
);

drop policy if exists replies_authenticated_update on public.replies;
create policy replies_authenticated_update on public.replies
for update to authenticated
using (user_id=auth.uid())
with check (
  user_id=auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id,auth.uid())
);

drop policy if exists reply_likes_authenticated_read on public.reply_likes;
create policy reply_likes_authenticated_read on public.reply_likes
for select to authenticated
using (
  exists (
    select 1 from public.replies r
    where r.id=reply_likes.reply_id
      and public.testagram_post_is_visible_to_viewer(r.post_id,auth.uid())
  )
);

drop policy if exists reply_likes_authenticated_insert on public.reply_likes;
create policy reply_likes_authenticated_insert on public.reply_likes
for insert to authenticated
with check (
  user_id=auth.uid()
  and exists (
    select 1 from public.replies r
    where r.id=reply_likes.reply_id
      and public.testagram_post_is_visible_to_viewer(r.post_id,auth.uid())
  )
);

drop policy if exists post_reposts_read on public.post_reposts;
drop policy if exists reposts_read on public.post_reposts;
create policy post_reposts_read on public.post_reposts
for select to anon, authenticated
using (public.testagram_post_is_visible_to_viewer(post_id,auth.uid()));

drop policy if exists post_reposts_own on public.post_reposts;
drop policy if exists reposts_write_own on public.post_reposts;
create policy post_reposts_own on public.post_reposts
for all to authenticated
using (user_id=auth.uid())
with check (
  user_id=auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id,auth.uid())
);

drop policy if exists post_quotes_read on public.post_quotes;
create policy post_quotes_read on public.post_quotes
for select to anon, authenticated
using (public.testagram_post_is_visible_to_viewer(post_id,auth.uid()));

drop policy if exists post_quotes_write on public.post_quotes;
create policy post_quotes_write on public.post_quotes
for all to authenticated
using (author_id=auth.uid())
with check (
  author_id=auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id,auth.uid())
);

drop policy if exists bookmarks_own on public.bookmarks;
drop policy if exists bookmarks_owner on public.bookmarks;
create policy bookmarks_owner on public.bookmarks
for all to authenticated
using (user_id=auth.uid())
with check (
  user_id=auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id,auth.uid())
);

drop policy if exists list_followers_read on public.list_followers;
create policy list_followers_read on public.list_followers
for select to authenticated
using (
  exists (
    select 1 from public.lists l
    where l.id=list_followers.list_id
      and (l.owner_id=auth.uid() or l.is_private=false)
  )
);

drop policy if exists hashtags_public_read on public.hashtags;
drop policy if exists hashtags_read on public.hashtags;
create policy hashtags_authenticated_read on public.hashtags
for select to authenticated
using (true);
