-- Forensic community hardening: authorization boundaries, durable events, and server-side moderation.
-- Generated for Testagram production schema.

create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text,
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_events_community_time_idx
  on public.community_events (community_id, scheduled_for asc);

create index if not exists community_events_creator_idx
  on public.community_events (created_by, scheduled_for desc);

alter table public.community_events enable row level security;

drop policy if exists "community events public/member read" on public.community_events;
create policy "community events public/member read"
on public.community_events
for select
to authenticated
using (
  exists (
    select 1 from public.communities c
    where c.id = community_events.community_id
      and (
        not c.is_private
        or exists (
          select 1 from public.community_members cm
          where cm.community_id = c.id
            and cm.user_id = (select auth.uid())
            and cm.status = 'active'
        )
      )
  )
);

drop policy if exists "community events member create" on public.community_events;
create policy "community events member create"
on public.community_events
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.community_members cm
    where cm.community_id = community_events.community_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
  )
);

drop policy if exists "community events owner/admin update" on public.community_events;
create policy "community events owner/admin update"
on public.community_events
for update
to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.community_members cm
    where cm.community_id = community_events.community_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
      and cm.role in ('owner','moderator')
  )
)
with check (
  exists (
    select 1 from public.community_members cm
    where cm.community_id = community_events.community_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
      and cm.role in ('owner','moderator')
  )
  or created_by = (select auth.uid())
);

drop policy if exists "community events owner/admin delete" on public.community_events;
create policy "community events owner/admin delete"
on public.community_events
for delete
to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.community_members cm
    where cm.community_id = community_events.community_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
      and cm.role in ('owner','moderator')
  )
);

grant select, insert, update, delete on public.community_events to authenticated;
revoke all on public.community_events from anon;

create or replace function public.community_actor_role(p_community_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $
  select case when cm.role = 'owner' then 'owner'
              when cm.role = 'moderator' then 'moderator'
              else 'member' end
  from public.community_members cm
  where cm.community_id = p_community_id
    and cm.user_id = (select auth.uid())
    and cm.status = 'active'
  limit 1;
$$;

create or replace function public.update_community_profile(
  p_community_id uuid,
  p_display_name text,
  p_description text,
  p_icon_url text,
  p_banner_url text
)
returns public.communities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_row public.communities;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_role := public.community_actor_role(p_community_id);
  if v_role not in ('owner','moderator') then
    raise exception 'NOT_COMMUNITY_ADMIN';
  end if;

  update public.communities
     set display_name = left(btrim(coalesce(p_display_name, display_name)), 60),
         description = nullif(left(btrim(coalesce(p_description, '')), 300), ''),
         icon_url = nullif(btrim(p_icon_url), ''),
         banner_url = nullif(btrim(p_banner_url), '')
   where id = p_community_id
   returning * into v_row;

  if not found then raise exception 'COMMUNITY_NOT_FOUND'; end if;
  return v_row;
end;
$$;

create or replace function public.update_community_rules(
  p_community_id uuid,
  p_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_rules jsonb;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  v_role := public.community_actor_role(p_community_id);
  if v_role not in ('owner','moderator') then raise exception 'NOT_COMMUNITY_ADMIN'; end if;

  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 20 then
    raise exception 'INVALID_RULES';
  end if;

  select coalesce(jsonb_agg(to_jsonb(left(btrim(value #>> '{}'), 240))), '[]'::jsonb)
    into v_rules
  from jsonb_array_elements(p_rules) e(value)
  where char_length(btrim(value #>> '{}')) > 0;

  update public.communities set rules = v_rules where id = p_community_id;
  if not found then raise exception 'COMMUNITY_NOT_FOUND'; end if;
  return v_rules;
end;
$$;

create or replace function public.set_community_member_role(
  p_membership_id uuid,
  p_role text
)
returns public.community_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_community uuid;
  v_actor_role text;
  v_row public.community_members;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_role not in ('member','moderator') then raise exception 'INVALID_ROLE'; end if;

  select community_id into v_community from public.community_members where id = p_membership_id;
  if v_community is null then raise exception 'MEMBER_NOT_FOUND'; end if;

  v_actor_role := public.community_actor_role(v_community);
  if v_actor_role <> 'owner' then raise exception 'OWNER_REQUIRED'; end if;

  update public.community_members
     set role = p_role
   where id = p_membership_id
     and role <> 'owner'
     and status = 'active'
   returning * into v_row;

  if not found then raise exception 'MEMBER_NOT_ACTIVE'; end if;
  return v_row;
end;
$$;

create or replace function public.remove_community_member(p_membership_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select community_id into v_community from public.community_members where id = p_membership_id;
  if v_community is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if public.community_actor_role(v_community) <> 'owner' then raise exception 'OWNER_REQUIRED'; end if;

  delete from public.community_members
   where id = p_membership_id
     and role <> 'owner';

  if not found then raise exception 'CANNOT_REMOVE_OWNER'; end if;
  return true;
end;
$$;

create or replace function public.moderate_community_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  select community_id into v_community from public.posts where id = p_post_id;
  if v_community is null then raise exception 'POST_NOT_FOUND_OR_NOT_COMMUNITY'; end if;
  if public.community_actor_role(v_community) not in ('owner','moderator') then
    raise exception 'NOT_COMMUNITY_ADMIN';
  end if;

  delete from public.posts where id = p_post_id and community_id = v_community;
  return found;
end;
$$;

create or replace function public.send_community_chat(
  p_community_id uuid,
  p_message text
)
returns public.community_chat
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.community_chat;
  v_message text := btrim(coalesce(p_message, ''));
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_message) < 1 or char_length(v_message) > 280 then raise exception 'INVALID_MESSAGE'; end if;

  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
  ) then raise exception 'COMMUNITY_MEMBERSHIP_REQUIRED'; end if;

  insert into public.community_chat(community_id, user_id, message)
  values (p_community_id, (select auth.uid()), v_message)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.create_community_event(
  p_community_id uuid,
  p_title text,
  p_description text,
  p_scheduled_for timestamptz
)
returns public.community_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.community_events;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
  ) then raise exception 'COMMUNITY_MEMBERSHIP_REQUIRED'; end if;

  if p_scheduled_for <= now() then raise exception 'EVENT_MUST_BE_IN_FUTURE'; end if;

  insert into public.community_events(community_id, created_by, title, description, scheduled_for)
  values (
    p_community_id, (select auth.uid()),
    left(btrim(p_title), 120),
    nullif(left(btrim(coalesce(p_description,'')), 500), ''),
    p_scheduled_for
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.mint_community_badge(p_community_id uuid)
returns public.community_nft_badges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_likes bigint;
  v_badge text;
  v_emoji text;
  v_row public.community_nft_badges;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
  ) then raise exception 'COMMUNITY_MEMBERSHIP_REQUIRED'; end if;

  select coalesce(sum(p.likes_count),0) into v_likes
  from public.posts p
  where p.community_id = mint_community_badge.p_community_id
    and p.user_id = (select auth.uid());

  if v_likes >= 10 then v_badge := 'legendary'; v_emoji := '💎';
  elsif v_likes >= 5 then v_badge := 'epic'; v_emoji := '🔮';
  else v_badge := 'rare'; v_emoji := '🏅';
  end if;

  insert into public.community_nft_badges(community_id, owner_id, badge_name, badge_emoji, badge_tier)
  values (p_community_id, (select auth.uid()), 'Community Badge', v_emoji, v_badge)
  on conflict (community_id, owner_id)
  do update set badge_name = excluded.badge_name, badge_emoji = excluded.badge_emoji, badge_tier = excluded.badge_tier
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.community_actor_role(uuid) from public, anon;
revoke execute on function public.update_community_profile(uuid,text,text,text,text) from public, anon;
revoke execute on function public.update_community_rules(uuid,jsonb) from public, anon;
revoke execute on function public.set_community_member_role(uuid,text) from public, anon;
revoke execute on function public.remove_community_member(uuid) from public, anon;
revoke execute on function public.moderate_community_post(uuid) from public, anon;
revoke execute on function public.send_community_chat(uuid,text) from public, anon;
revoke execute on function public.create_community_event(uuid,text,text,timestamptz) from public, anon;
revoke execute on function public.mint_community_badge(uuid) from public, anon;

grant execute on function public.community_actor_role(uuid) to authenticated;
grant execute on function public.update_community_profile(uuid,text,text,text,text) to authenticated;
grant execute on function public.update_community_rules(uuid,jsonb) to authenticated;
grant execute on function public.set_community_member_role(uuid,text) to authenticated;
grant execute on function public.remove_community_member(uuid) to authenticated;
grant execute on function public.moderate_community_post(uuid) to authenticated;
grant execute on function public.send_community_chat(uuid,text) to authenticated;
grant execute on function public.create_community_event(uuid,text,text,timestamptz) to authenticated;
grant execute on function public.mint_community_badge(uuid) to authenticated;

-- Remove browser-side privilege escalation paths. RPCs above become the mutation boundary.
revoke insert, update, delete on table public.community_members from authenticated;
grant select on table public.community_members to authenticated;

revoke insert, update, delete on table public.community_chat from authenticated;
grant select on table public.community_chat to authenticated;

create index if not exists posts_community_created_at_idx
  on public.posts (community_id, created_at desc, id desc);

create index if not exists community_members_community_status_role_idx
  on public.community_members (community_id, status, role, id);

create index if not exists community_chat_community_created_at_idx
  on public.community_chat (community_id, created_at desc, id desc);


create table if not exists public.community_event_rsvps (
  event_id uuid not null references public.community_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.community_event_rsvps enable row level security;

drop policy if exists "community event rsvps member read" on public.community_event_rsvps;
create policy "community event rsvps member read"
on public.community_event_rsvps
for select
to authenticated
using (
  exists (
    select 1 from public.community_events e
    join public.community_members cm on cm.community_id = e.community_id
    where e.id = community_event_rsvps.event_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
  )
);

drop policy if exists "community event rsvps own insert" on public.community_event_rsvps;
create policy "community event rsvps own insert"
on public.community_event_rsvps
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.community_events e
    join public.community_members cm on cm.community_id = e.community_id
    where e.id = community_event_rsvps.event_id
      and cm.user_id = (select auth.uid())
      and cm.status = 'active'
  )
);

drop policy if exists "community event rsvps own delete" on public.community_event_rsvps;
create policy "community event rsvps own delete"
on public.community_event_rsvps
for delete
to authenticated
using (user_id = (select auth.uid()));

grant select, insert, delete on public.community_event_rsvps to authenticated;
revoke all on public.community_event_rsvps from anon;

create index if not exists community_event_rsvps_event_idx
  on public.community_event_rsvps (event_id, created_at desc);


create or replace function public.get_trending_communities(p_limit integer default 5)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      to_jsonb(x.c)
      || jsonb_build_object('recent_posts', x.recent_posts)
      order by x.recent_posts desc, x.member_count desc
    ),
    '[]'::jsonb
  )
  from (
    select c, count(p.id)::bigint as recent_posts
    from public.communities c
    left join public.posts p
      on p.community_id = c.id
     and p.created_at >= now() - interval '48 hours'
    group by c.id
    order by count(p.id) desc, c.member_count desc
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ) x;
$$;

revoke execute on function public.get_trending_communities(integer) from public;
grant execute on function public.get_trending_communities(integer) to anon, authenticated;

-- Explicit Data API grants for tables exposed to authenticated clients.
grant select on public.community_events to authenticated;
grant select, insert, delete on public.community_event_rsvps to authenticated;

-- Do not expose privileged helper functions through the anonymous API.
revoke execute on function public.community_actor_role(uuid) from anon;

