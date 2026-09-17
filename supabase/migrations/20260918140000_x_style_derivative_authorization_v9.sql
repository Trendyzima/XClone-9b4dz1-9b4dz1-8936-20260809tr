-- X-style derivative authorization hardening v9
-- Align direct table access with the canonical post/profile visibility boundary.

create or replace function public.testagram_profile_is_visible_to_viewer(p_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id=p_profile_id
      and (pr.protected_account=false or pr.id=auth.uid() or exists (
        select 1 from public.follows f
        where f.follower_id=auth.uid() and f.following_id=pr.id and f.status='accepted'
      ))
  );
$$;
revoke all on function public.testagram_profile_is_visible_to_viewer(uuid) from public;
grant execute on function public.testagram_profile_is_visible_to_viewer(uuid) to anon,authenticated;

create or replace function public.testagram_post_is_interactable_to_viewer(p_post_id uuid,p_viewer_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.posts p
    where p.id=p_post_id
      and public.testagram_post_is_visible_to_viewer(p.id,p_viewer_id)
      and (p_viewer_id is null or not exists (
        select 1 from public.user_blocks ub
        where (ub.blocker_id=p_viewer_id and ub.blocked_id=coalesce(p.author_id,p.user_id))
           or (ub.blocker_id=coalesce(p.author_id,p.user_id) and ub.blocked_id=p_viewer_id)
      ))
  );
$$;
revoke all on function public.testagram_post_is_interactable_to_viewer(uuid,uuid) from public;
grant execute on function public.testagram_post_is_interactable_to_viewer(uuid,uuid) to anon,authenticated;


drop policy if exists reply_likes_authenticated_read on public.reply_likes;
create policy reply_likes_authenticated_read on public.reply_likes for select to authenticated using (exists (select 1 from public.replies r where r.id=reply_likes.reply_id and public.testagram_post_is_visible_to_viewer(r.post_id,auth.uid())));

drop policy if exists reply_likes_authenticated_insert on public.reply_likes;
create policy reply_likes_authenticated_insert on public.reply_likes for insert to authenticated with check (user_id=auth.uid() and exists (select 1 from public.replies r where r.id=reply_likes.reply_id and public.testagram_post_is_interactable_to_viewer(r.post_id,auth.uid())));

drop policy if exists post_reposts_read on public.post_reposts;
drop policy if exists reposts_read on public.post_reposts;
create policy post_reposts_read on public.post_reposts for select to anon,authenticated using (
  public.testagram_post_is_visible_to_viewer(post_id,auth.uid()) and public.testagram_profile_is_visible_to_viewer(user_id)
);

drop policy if exists post_reposts_own on public.post_reposts;
drop policy if exists reposts_write_own on public.post_reposts;
create policy post_reposts_own on public.post_reposts for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and public.testagram_post_is_interactable_to_viewer(post_id,auth.uid()));

drop policy if exists post_quotes_read on public.post_quotes;
create policy post_quotes_read on public.post_quotes for select to anon,authenticated using (
  public.testagram_post_is_visible_to_viewer(post_id,auth.uid()) and public.testagram_profile_is_visible_to_viewer(author_id)
);

drop policy if exists post_quotes_write on public.post_quotes;
create policy post_quotes_write on public.post_quotes for all to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid() and public.testagram_post_is_interactable_to_viewer(post_id,auth.uid()));

drop policy if exists bookmarks_own on public.bookmarks;
drop policy if exists bookmarks_owner on public.bookmarks;
create policy bookmarks_owner on public.bookmarks for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and public.testagram_post_is_interactable_to_viewer(post_id,auth.uid()));

drop policy if exists list_followers_read on public.list_followers;
create policy list_followers_read on public.list_followers for select to authenticated using (exists (select 1 from public.lists l where l.id=list_followers.list_id and (l.owner_id=auth.uid() or l.is_private=false)));

drop policy if exists hashtags_public_read on public.hashtags;
drop policy if exists hashtags_read on public.hashtags;
create policy hashtags_authenticated_read on public.hashtags for select to authenticated using (true);
