create policy "follows_public_read_for_visible_profiles"
on public.follows
for select
to anon, authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = follows.following_id
      and p.account_status = 'active'
      and (p.visibility = 'public' or p.id = (select auth.uid()))
  )
  or exists (
    select 1 from public.profiles p
    where p.id = follows.follower_id
      and p.account_status = 'active'
      and (p.visibility = 'public' or p.id = (select auth.uid()))
  )
);
