-- X-style derivative authorization hardening v10
-- Avoid recursive RLS while enforcing protected follower/following visibility.

create or replace function public.testagram_profile_is_visible_to_viewer(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id=p_profile_id
      and (
        pr.protected_account=false
        or pr.id=auth.uid()
        or exists (
          select 1
          from public.follows f
          where f.follower_id=auth.uid()
            and f.following_id=pr.id
            and f.status='accepted'
        )
      )
  );
$$;

revoke all on function public.testagram_profile_is_visible_to_viewer(uuid) from public;
grant execute on function public.testagram_profile_is_visible_to_viewer(uuid) to anon,authenticated;

drop policy if exists follows_public_read on public.follows;
create policy follows_public_read on public.follows
for select to anon,authenticated
using (
  status='accepted'
  and public.testagram_profile_is_visible_to_viewer(follower_id)
  and public.testagram_profile_is_visible_to_viewer(following_id)
);
