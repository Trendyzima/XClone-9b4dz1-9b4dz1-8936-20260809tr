-- Keep the profile counters used by the web and Flutter clients in sync with
-- the canonical accepted follow relationships. The old client-side count was
-- derived from a maximum of 1,000 rows, and the stored counters were never
-- maintained by a follows trigger.

create index if not exists follows_accepted_following_idx
  on public.follows (following_id)
  where status = 'accepted';

create index if not exists follows_accepted_follower_idx
  on public.follows (follower_id)
  where status = 'accepted';

create or replace function public.sync_profile_follow_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      update public.profiles
      set following_count = greatest(0, coalesce(following_count, 0) + 1),
          updated_at = now()
      where id = new.follower_id;

      update public.profiles
      set follower_count = greatest(0, coalesce(follower_count, 0) + 1),
          updated_at = now()
      where id = new.following_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status = 'accepted' then
      update public.profiles
      set following_count = greatest(0, coalesce(following_count, 0) - 1),
          updated_at = now()
      where id = old.follower_id;

      update public.profiles
      set follower_count = greatest(0, coalesce(follower_count, 0) - 1),
          updated_at = now()
      where id = old.following_id;
    end if;
    return old;
  end if;

  -- UPDATE: remove the old accepted edge and/or add the new accepted edge.
  if old.status = 'accepted'
     and (
       new.status is distinct from 'accepted'
       or old.follower_id is distinct from new.follower_id
       or old.following_id is distinct from new.following_id
     ) then
    update public.profiles
    set following_count = greatest(0, coalesce(following_count, 0) - 1),
        updated_at = now()
    where id = old.follower_id;

    update public.profiles
    set follower_count = greatest(0, coalesce(follower_count, 0) - 1),
        updated_at = now()
    where id = old.following_id;
  end if;

  if new.status = 'accepted'
     and (
       old.status is distinct from 'accepted'
       or old.follower_id is distinct from new.follower_id
       or old.following_id is distinct from new.following_id
     ) then
    update public.profiles
    set following_count = greatest(0, coalesce(following_count, 0) + 1),
        updated_at = now()
    where id = new.follower_id;

    update public.profiles
    set follower_count = greatest(0, coalesce(follower_count, 0) + 1),
        updated_at = now()
    where id = new.following_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_profile_follow_counters() from public, anon, authenticated;

drop trigger if exists follows_sync_profile_counters on public.follows;
create trigger follows_sync_profile_counters
after insert or update or delete
on public.follows
for each row
execute function public.sync_profile_follow_counters();

-- Repair all historical drift from the canonical relationship table.
update public.profiles p
set follower_count = (
      select count(*)::integer
      from public.follows f
      where f.following_id = p.id
        and f.status = 'accepted'
    ),
    following_count = (
      select count(*)::integer
      from public.follows f
      where f.follower_id = p.id
        and f.status = 'accepted'
    ),
    updated_at = now();

-- Reclaim stale leases once. The delivery worker's watchdog continues to
-- recover future stale in-flight rows on each run.
update public.federation_deliveries
set status = 'retry',
    locked_at = null,
    next_attempt_at = now(),
    last_error = coalesce(last_error, 'Recovered stale in-flight delivery during profile/federation repair'),
    updated_at = now()
where status = 'in_flight'
  and delivered_at is null
  and (locked_at is null or locked_at < now() - interval '2 minutes');
