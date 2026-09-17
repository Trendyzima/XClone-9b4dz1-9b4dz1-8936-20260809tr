-- X-style helper hardening v14
-- Prevent exposed security-definer helpers from accepting an arbitrary viewer identity.

drop policy if exists follows_block_guard on public.follows;
drop policy if exists follow_requests_block_guard on public.follow_requests;
drop policy if exists list_members_insert on public.list_members;
drop policy if exists list_members_write on public.list_members;

do $$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='capability_dispatch' limit 1;
 src:=replace(src,'public.testagram_accounts_blocked_between(u,id)','public.testagram_accounts_blocked_between(id)');
 src:=replace(src,'public.testagram_accounts_blocked_between(u,pr.id)','public.testagram_accounts_blocked_between(pr.id)');
 execute src;
end $$;

create or replace function public.testagram_accounts_blocked_between(p_other_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
select auth.uid() is not null and exists (
 select 1 from public.user_blocks ub
 where (ub.blocker_id=auth.uid() and ub.blocked_id=p_other_user)
    or (ub.blocker_id=p_other_user and ub.blocked_id=auth.uid())
);
$$;
revoke all on function public.testagram_accounts_blocked_between(uuid) from public;
grant execute on function public.testagram_accounts_blocked_between(uuid) to anon,authenticated;
drop function if exists public.testagram_accounts_blocked_between(uuid,uuid);

create or replace function public.testagram_post_is_visible_to_viewer(p_post_id uuid,p_viewer_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
select exists (
 select 1 from public.posts p
 where p.id=p_post_id and p.deleted_at is null and p_viewer_id is not distinct from auth.uid()
 and (
  (p.community_id is null and exists (
    select 1 from public.profiles pr where pr.id=coalesce(p.author_id,p.user_id)
    and (pr.protected_account=false or pr.id=p_viewer_id or exists (
      select 1 from public.follows f where f.follower_id=p_viewer_id and f.following_id=pr.id and f.status='accepted'
    ))
  ))
  or
  (p.community_id is not null and exists (
    select 1 from public.communities c where c.id=p.community_id and (
      c.is_private=false or exists (
        select 1 from public.community_members cm where cm.community_id=c.id and cm.user_id=p_viewer_id and cm.status='active'
      )
    )
  ))
 )
);
$$;

create or replace function public.testagram_post_is_interactable_to_viewer(p_post_id uuid,p_viewer_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
select exists (
 select 1 from public.posts p
 where p.id=p_post_id and p_viewer_id is not distinct from auth.uid()
 and public.testagram_post_is_visible_to_viewer(p.id,p_viewer_id)
 and (p_viewer_id is null or not exists (
   select 1 from public.user_blocks ub
   where (ub.blocker_id=p_viewer_id and ub.blocked_id=coalesce(p.author_id,p.user_id))
      or (ub.blocker_id=coalesce(p.author_id,p.user_id) and ub.blocked_id=p_viewer_id)
 ))
);
$$;

create policy follows_block_guard on public.follows as restrictive for all to authenticated
using (not public.testagram_accounts_blocked_between(follows.following_id) and not public.testagram_accounts_blocked_between(follows.follower_id))
with check (not public.testagram_accounts_blocked_between(follows.following_id) and not public.testagram_accounts_blocked_between(follows.follower_id));

create policy follow_requests_block_guard on public.follow_requests as restrictive for all to authenticated
using (not public.testagram_accounts_blocked_between(follow_requests.target_id) and not public.testagram_accounts_blocked_between(follow_requests.requester_id))
with check (not public.testagram_accounts_blocked_between(follow_requests.target_id) and not public.testagram_accounts_blocked_between(follow_requests.requester_id));

create policy list_members_insert on public.list_members for insert to authenticated
with check (exists(select 1 from public.lists l where l.id=list_members.list_id and l.owner_id=auth.uid()) and not public.testagram_accounts_blocked_between(list_members.user_id));

create policy list_members_write on public.list_members for all to authenticated
using (exists(select 1 from public.lists l where l.id=list_members.list_id and l.owner_id=auth.uid()))
with check (exists(select 1 from public.lists l where l.id=list_members.list_id and l.owner_id=auth.uid()) and not public.testagram_accounts_blocked_between(list_members.user_id));
