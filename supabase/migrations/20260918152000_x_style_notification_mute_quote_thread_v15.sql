-- X-style notifications, mute, thread, and quote boundary v15

drop policy if exists quote_posts_read on public.quote_posts;
create policy quote_posts_read on public.quote_posts for select to anon,authenticated using (
  public.testagram_post_is_visible_to_viewer(post_id,auth.uid())
  and public.testagram_post_is_visible_to_viewer(quoted_post_id,auth.uid())
);

drop policy if exists thread_likes_authenticated_read on public.thread_likes;
create policy thread_likes_authenticated_read on public.thread_likes for select to authenticated using (
  exists(select 1 from public.threads t join public.profiles pr on pr.id=t.user_id where t.id=thread_likes.thread_id and t.is_published=true
    and (pr.protected_account=false or pr.id=auth.uid() or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=pr.id and f.status='accepted'))
    and not public.testagram_accounts_blocked_between(t.user_id))
);
drop policy if exists thread_likes_authenticated_insert on public.thread_likes;
create policy thread_likes_authenticated_insert on public.thread_likes for insert to authenticated with check (
  user_id=auth.uid() and exists(select 1 from public.threads t where t.id=thread_likes.thread_id and t.is_published=true and not public.testagram_accounts_blocked_between(t.user_id))
);

drop policy if exists thread_reposts_authenticated_read on public.thread_reposts;
create policy thread_reposts_authenticated_read on public.thread_reposts for select to authenticated using (
  exists(select 1 from public.threads t join public.profiles pr on pr.id=t.user_id where t.id=thread_reposts.thread_id and t.is_published=true
    and (pr.protected_account=false or pr.id=auth.uid() or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=pr.id and f.status='accepted'))
    and not public.testagram_accounts_blocked_between(t.user_id))
);
drop policy if exists thread_reposts_authenticated_insert on public.thread_reposts;
create policy thread_reposts_authenticated_insert on public.thread_reposts for insert to authenticated with check (
  user_id=auth.uid() and exists(select 1 from public.threads t where t.id=thread_reposts.thread_id and t.is_published=true and not public.testagram_accounts_blocked_between(t.user_id))
);

drop policy if exists notifications_read_own on public.notifications;
drop policy if exists notifications_recipient_read on public.notifications;
create policy notifications_recipient_read on public.notifications for select to authenticated using (
  recipient_id=auth.uid()
  and not exists(select 1 from public.user_blocks ub where (ub.blocker_id=auth.uid() and ub.blocked_id=actor_id) or (ub.blocker_id=actor_id and ub.blocked_id=auth.uid()))
  and (actor_id is null or not exists(select 1 from public.mutes m where m.muter_id=auth.uid() and m.muted_id=actor_id)
       or (kind in ('mention','reply') and exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=actor_id and f.status='accepted')))
);

create or replace function public.enqueue_notification_delivery()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.actor_id is not null and exists(select 1 from public.user_blocks ub where (ub.blocker_id=new.recipient_id and ub.blocked_id=new.actor_id) or (ub.blocker_id=new.actor_id and ub.blocked_id=new.recipient_id)) then return new; end if;
  if new.actor_id is not null and exists(select 1 from public.mutes m where m.muter_id=new.recipient_id and m.muted_id=new.actor_id)
     and not (new.kind in ('mention','reply') and exists(select 1 from public.follows f where f.follower_id=new.recipient_id and f.following_id=new.actor_id and f.status='accepted')) then return new; end if;
  insert into public.notification_delivery_outbox(notification_id,recipient_id,event_name,payload)
  values(new.id,new.recipient_id,new.kind,jsonb_build_object('notification_id',new.id,'recipient_id',new.recipient_id,'actor_id',new.actor_id,'kind',new.kind,'post_id',new.post_id,'category',new.category,'priority',new.priority,'group_key',new.group_key,'action_url',new.action_url))
  on conflict(notification_id) do nothing;
  return new;
end;
$$;
