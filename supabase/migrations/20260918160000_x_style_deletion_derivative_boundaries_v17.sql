-- Deletion/moderation derivative boundary v17
-- Never expose content-derived records when their root post is no longer visible.

drop policy if exists mentions_public_read on public.mentions;
create policy mentions_public_read on public.mentions
for select to anon, authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = mentions.post_id
      and public.testagram_post_is_visible_to_viewer(p.id, auth.uid())
  )
);

drop policy if exists recommendations_select_own on public.content_recommendations;
create policy recommendations_select_own on public.content_recommendations
for select to authenticated
using (
  user_id = auth.uid()
  and public.testagram_post_is_visible_to_viewer(recommended_post_id, auth.uid())
);

drop policy if exists bookmarks_owner on public.bookmarks;
create policy bookmarks_owner on public.bookmarks
for all to authenticated
using (
  user_id = auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id, auth.uid())
)
with check (
  user_id = auth.uid()
  and public.testagram_post_is_interactable_to_viewer(post_id, auth.uid())
);

drop policy if exists post_shares_read on public.post_shares;
create policy post_shares_read on public.post_shares
for select to authenticated
using (
  (user_id = auth.uid() or user_id is null)
  and public.testagram_post_is_visible_to_viewer(post_id, auth.uid())
);

drop policy if exists post_views_own on public.post_views;
create policy post_views_own on public.post_views
for all to authenticated
using (
  viewer_id = auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id, auth.uid())
)
with check (
  viewer_id = auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id, auth.uid())
);

drop policy if exists post_views_owner on public.post_views;
create policy post_views_owner on public.post_views
for all to authenticated
using (
  user_id = auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id, auth.uid())
)
with check (
  user_id = auth.uid()
  and public.testagram_post_is_visible_to_viewer(post_id, auth.uid())
);

drop policy if exists notifications_recipient_read on public.notifications;
create policy notifications_recipient_read on public.notifications
for select to authenticated
using (
  recipient_id = auth.uid()
  and (
    post_id is null
    or public.testagram_post_is_visible_to_viewer(post_id, auth.uid())
  )
  and not exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = auth.uid() and ub.blocked_id = notifications.actor_id)
       or (ub.blocker_id = notifications.actor_id and ub.blocked_id = auth.uid())
  )
  and (
    actor_id is null
    or not exists (
      select 1 from public.mutes m
      where m.muter_id = auth.uid() and m.muted_id = notifications.actor_id
    )
    or (
      kind in ('mention','reply')
      and exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid()
          and f.following_id = notifications.actor_id
          and f.status='accepted'
      )
    )
  )
);

create or replace function public.suppress_deleted_post_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path=public
as $fn$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.notification_delivery_outbox
    where status in ('pending','failed')
      and notification_id in (
        select n.id from public.notifications n where n.post_id = new.id
      );
  end if;
  return new;
end;
$fn$;

drop trigger if exists posts_suppress_deleted_notification_delivery on public.posts;
create trigger posts_suppress_deleted_notification_delivery
after update of deleted_at on public.posts
for each row
when (new.deleted_at is not null and old.deleted_at is null)
execute function public.suppress_deleted_post_notification_delivery();

revoke all on function public.suppress_deleted_post_notification_delivery() from public;
