create table if not exists public.platform_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('trending', 'payment', 'news', 'update', 'tip')),
  subject text not null,
  body text not null,
  icon_emoji text,
  cta_label text,
  cta_url text,
  read boolean not null default false,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  generation_version integer not null default 1,
  unique (user_id, dedupe_key)
);

create index if not exists platform_inbox_user_sent_idx on public.platform_inbox (user_id, sent_at desc);
create index if not exists platform_inbox_user_unread_idx on public.platform_inbox (user_id, read, sent_at desc);

alter table public.platform_inbox enable row level security;
revoke all on table public.platform_inbox from anon;
grant select, update, delete on table public.platform_inbox to authenticated;

drop policy if exists "platform inbox select own" on public.platform_inbox;
drop policy if exists "platform inbox update own" on public.platform_inbox;
drop policy if exists "platform inbox delete own" on public.platform_inbox;
create policy "platform inbox select own" on public.platform_inbox for select to authenticated using ((select auth.uid()) = user_id);
create policy "platform inbox update own" on public.platform_inbox for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "platform inbox delete own" on public.platform_inbox for delete to authenticated using ((select auth.uid()) = user_id);

create schema if not exists platform_private;
revoke all on schema platform_private from public, anon;
grant usage on schema platform_private to authenticated;

create or replace function platform_private.generate_platform_inbox_digest()
returns setof public.platform_inbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_today text := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
  v_followers bigint := 0;
  v_following bigint := 0;
  v_profile_views bigint := 0;
  v_posts bigint := 0;
  v_views bigint := 0;
  v_likes bigint := 0;
  v_reposts bigint := 0;
  v_notifications bigint := 0;
  v_balance numeric := 0;
  v_currency text := 'KES';
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;

  select coalesce(p.follower_count, 0), coalesce(p.following_count, 0), coalesce(p.profile_views, 0)
    into v_followers, v_following, v_profile_views
  from public.profiles p where p.id = v_user_id;

  select count(*)::bigint,
         coalesce(sum(coalesce(p.view_count, p.views_count, 0)), 0)::bigint,
         coalesce(sum(coalesce(p.likes_count, p.like_count, 0)), 0)::bigint,
         coalesce(sum(coalesce(p.reposts_count, p.repost_count, 0)), 0)::bigint
    into v_posts, v_views, v_likes, v_reposts
  from public.posts p
  where coalesce(p.author_id, p.user_id) = v_user_id
    and p.created_at >= now() - interval '7 days'
    and p.deleted_at is null;

  select count(*)::bigint into v_notifications
  from public.notifications n
  where n.recipient_id = v_user_id and n.created_at >= now() - interval '7 days' and n.archived_at is null;

  select coalesce(w.balance, w.balance_cents / 100.0, 0), coalesce(w.currency, 'KES')
    into v_balance, v_currency
  from public.wallets w where w.user_id = v_user_id order by w.updated_at desc nulls last limit 1;

  insert into public.platform_inbox (user_id, type, subject, body, icon_emoji, cta_label, cta_url, read, sent_at, dedupe_key, metadata, generation_version)
  values
    (v_user_id, 'update', 'Your Wise Brain growth briefing',
      format('You currently have %s followers, follow %s accounts, and your profile has %s views. Keep showing up consistently and turn your strongest posts into repeatable growth.', to_char(v_followers, 'FM999,999,999,990'), to_char(v_following, 'FM999,999,999,990'), to_char(v_profile_views, 'FM999,999,999,990')),
      '📈', 'Open Profile', '/profile', false, now(), 'growth-' || v_today,
      jsonb_build_object('followers', v_followers, 'following', v_following, 'profile_views', v_profile_views, 'window_days', 7), 1),
    (v_user_id, 'trending', 'Your content performance this week',
      format('%s post%s generated %s views, %s likes, and %s reposts in the last 7 days. Your next opportunity is to build on the format and topic that already gets attention.', to_char(v_posts, 'FM999,999,999,990'), case when v_posts = 1 then '' else 's' end, to_char(v_views, 'FM999,999,999,990'), to_char(v_likes, 'FM999,999,999,990'), to_char(v_reposts, 'FM999,999,999,990')),
      '🔥', 'View Your Posts', '/profile', false, now(), 'content-' || v_today,
      jsonb_build_object('posts', v_posts, 'views', v_views, 'likes', v_likes, 'reposts', v_reposts, 'window_days', 7), 1),
    (v_user_id, 'payment', 'Your wallet snapshot',
      format('Your current wallet balance is %s %s. Wise Brain will keep this briefing tied to your platform activity rather than inventing earnings.', to_char(v_balance, 'FM999,999,999,990.00'), v_currency),
      '💰', 'View Wallet', '/wallet', false, now(), 'wallet-' || v_today,
      jsonb_build_object('balance', v_balance, 'currency', v_currency), 1),
    (v_user_id, 'news', 'Your activity briefing',
      format('You had %s platform notification%s in the last 7 days. Review important alerts, mentions, and account updates so nothing important is missed.', to_char(v_notifications, 'FM999,999,999,990'), case when v_notifications = 1 then '' else 's' end),
      '🦉', 'Open Alerts', '/alerts', false, now(), 'activity-' || v_today,
      jsonb_build_object('notifications_7d', v_notifications, 'window_days', 7), 1)
  on conflict (user_id, dedupe_key) do update set
    type = excluded.type, subject = excluded.subject, body = excluded.body, icon_emoji = excluded.icon_emoji,
    cta_label = excluded.cta_label, cta_url = excluded.cta_url, sent_at = excluded.sent_at,
    metadata = excluded.metadata, generation_version = excluded.generation_version;

  return query select * from public.platform_inbox
    where user_id = v_user_id and dedupe_key in ('growth-' || v_today, 'content-' || v_today, 'wallet-' || v_today, 'activity-' || v_today)
    order by sent_at desc, created_at desc;
end;
$$;

revoke all on function platform_private.generate_platform_inbox_digest() from public, anon;
grant execute on function platform_private.generate_platform_inbox_digest() to authenticated;

create or replace function public.generate_platform_inbox_digest()
returns setof public.platform_inbox
language sql
security invoker
set search_path = ''
as $$ select * from platform_private.generate_platform_inbox_digest(); $$;
revoke all on function public.generate_platform_inbox_digest() from public, anon;
grant execute on function public.generate_platform_inbox_digest() to authenticated;
