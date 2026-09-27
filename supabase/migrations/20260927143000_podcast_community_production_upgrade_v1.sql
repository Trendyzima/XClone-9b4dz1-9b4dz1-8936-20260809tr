-- Podcast + community production hardening v1.

drop policy if exists community_members_read_self_or_owner on public.community_members;
create policy community_members_read on public.community_members
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.communities c
    where c.id = community_members.community_id
      and (
        c.visibility = 'public'
        or c.owner_id = (select auth.uid())
        or exists (
          select 1 from public.community_members m
          where m.community_id = c.id
            and m.user_id = (select auth.uid())
            and m.status = 'active'
        )
      )
  )
);

drop policy if exists community_members_insert_self_or_owner on public.community_members;
create policy community_members_insert_self_or_owner on public.community_members
for insert to authenticated
with check (
  (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.communities c
      where c.id = community_members.community_id
        and (c.visibility = 'public' or community_members.status = 'pending')
    )
  )
  or exists (
    select 1 from public.communities c
    where c.id = community_members.community_id
      and c.owner_id = (select auth.uid())
  )
);

create or replace function public.join_community(p_community_id uuid)
returns public.community_members
language plpgsql security invoker
set search_path = pg_catalog, public
as $function$
declare u uuid := auth.uid(); c public.communities; result public.community_members; next_status text;
begin
  if u is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into c from public.communities where id=p_community_id;
  if c.id is null then raise exception 'COMMUNITY_NOT_FOUND' using errcode='P0002'; end if;
  next_status := case when c.visibility='public' then 'active' else 'pending' end;
  insert into public.community_members(community_id,user_id,role,status)
  values(p_community_id,u,'member',next_status)
  on conflict (community_id,user_id)
  do update set status = case
    when public.community_members.role='owner' then public.community_members.status
    when public.community_members.status='active' then 'active'
    else excluded.status
  end
  returning * into result;
  return result;
end
$function$;

create or replace function public.leave_community(p_community_id uuid)
returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $function$
begin
  delete from public.community_members
  where community_id=p_community_id and user_id=auth.uid() and role <> 'owner';
  return found;
end
$function$;

revoke execute on function public.join_community(uuid) from anon, public;
revoke execute on function public.leave_community(uuid) from anon, public;
grant execute on function public.join_community(uuid) to authenticated;
grant execute on function public.leave_community(uuid) to authenticated;

create index if not exists communities_name_trgm_idx on public.communities using gin (name gin_trgm_ops);
create index if not exists communities_display_name_trgm_idx on public.communities using gin (display_name gin_trgm_ops);
create index if not exists communities_created_at_idx on public.communities (created_at desc);
create index if not exists communities_member_count_idx on public.communities (member_count desc, post_count desc, created_at desc);

create index if not exists podcasts_status_created_idx on public.podcasts (status, created_at desc);
create index if not exists podcasts_owner_status_idx on public.podcasts (owner_id, status, updated_at desc);
create index if not exists podcast_episodes_podcast_published_idx on public.podcast_episodes (podcast_id, published_at desc, created_at desc);
create index if not exists podcast_episodes_published_idx on public.podcast_episodes (published_at desc, created_at desc);
create index if not exists podcast_episodes_title_trgm_idx on public.podcast_episodes using gin (title gin_trgm_ops);

drop policy if exists podcasts_owner on public.podcasts;
create policy podcasts_owner_select on public.podcasts for select to authenticated using (status='published' or owner_id=(select auth.uid()));
create policy podcasts_owner_insert on public.podcasts for insert to authenticated with check (owner_id=(select auth.uid()));
create policy podcasts_owner_update on public.podcasts for update to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy podcasts_owner_delete on public.podcasts for delete to authenticated using (owner_id=(select auth.uid()));

drop policy if exists podcast_episodes_read on public.podcast_episodes;
create policy podcast_episodes_read on public.podcast_episodes for select to authenticated using (
  published_at is not null
  or exists (select 1 from public.podcasts p where p.id=podcast_episodes.podcast_id and p.owner_id=(select auth.uid()))
);
create policy podcast_episodes_owner_insert on public.podcast_episodes for insert to authenticated with check (
  exists (select 1 from public.podcasts p where p.id=podcast_episodes.podcast_id and p.owner_id=(select auth.uid()))
);
create policy podcast_episodes_owner_update on public.podcast_episodes for update to authenticated using (
  exists (select 1 from public.podcasts p where p.id=podcast_episodes.podcast_id and p.owner_id=(select auth.uid()))
) with check (
  exists (select 1 from public.podcasts p where p.id=podcast_episodes.podcast_id and p.owner_id=(select auth.uid()))
);
create policy podcast_episodes_owner_delete on public.podcast_episodes for delete to authenticated using (
  exists (select 1 from public.podcasts p where p.id=podcast_episodes.podcast_id and p.owner_id=(select auth.uid()))
);

grant select, insert, update, delete on public.podcasts to authenticated;
grant select, insert, update, delete on public.podcast_episodes to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    begin alter publication supabase_realtime add table public.podcasts; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.podcast_episodes; exception when duplicate_object then null; end;
  end if;
end $$;