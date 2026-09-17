-- Community admin controls: server-authoritative member addition and community-scoped media writes.

create or replace function public.add_community_members(p_community_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer := 0;
  v_uid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.can_manage_community(p_community_id, auth.uid()) then
    raise exception 'not authorized to manage this community';
  end if;

  if p_user_ids is null or coalesce(array_length(p_user_ids, 1), 0) = 0 then
    return 0;
  end if;

  foreach v_uid in array p_user_ids loop
    if v_uid is null then continue; end if;

    insert into public.community_members (community_id, user_id, role, status)
    values (p_community_id, v_uid, 'member', 'active')
    on conflict (community_id, user_id) do update
      set status = 'active'
      where public.community_members.status <> 'active';

    if found then
      v_added := v_added + 1;
    end if;
  end loop;

  update public.communities c
     set member_count = (
       select count(*)
       from public.community_members cm
       where cm.community_id = c.id
         and cm.status = 'active'
     ),
     updated_at = now()
   where c.id = p_community_id;

  return v_added;
end;
$$;

revoke all on function public.add_community_members(uuid, uuid[]) from public;
grant execute on function public.add_community_members(uuid, uuid[]) to authenticated;

-- Community media is stored under communities/<community-id>/<kind>/... so
-- storage authorization can independently verify the same community boundary.
drop policy if exists "community_media_admin_insert" on storage.objects;
drop policy if exists "community_media_admin_update" on storage.objects;
drop policy if exists "community_media_admin_delete" on storage.objects;

create policy "community_media_admin_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'tv49-profile-media'
  and (storage.foldername(name))[1] = 'communities'
  and public.can_manage_community(
    case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
         then ((storage.foldername(name))[2])::uuid
         else null end,
    auth.uid()
  )
);

create policy "community_media_admin_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'tv49-profile-media'
  and (storage.foldername(name))[1] = 'communities'
  and public.can_manage_community(
    case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
         then ((storage.foldername(name))[2])::uuid
         else null end,
    auth.uid()
  )
)
with check (
  bucket_id = 'tv49-profile-media'
  and (storage.foldername(name))[1] = 'communities'
  and public.can_manage_community(
    case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
         then ((storage.foldername(name))[2])::uuid
         else null end,
    auth.uid()
  )
);

create policy "community_media_admin_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'tv49-profile-media'
  and (storage.foldername(name))[1] = 'communities'
  and public.can_manage_community(
    case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
         then ((storage.foldername(name))[2])::uuid
         else null end,
    auth.uid()
  )
);
