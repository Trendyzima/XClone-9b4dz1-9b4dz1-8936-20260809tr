-- Backward-compatible schema bridge for older Testagram clients.
-- Canonical fields remain authoritative; compatibility fields mirror them so stale
-- clients fail closed less often while the platform migrates to the unified contracts.
alter table public.conversations add column if not exists participant_1 uuid;
alter table public.conversations add column if not exists participant_2 uuid;
alter table public.creator_earnings add column if not exists user_id uuid;
alter table public.creator_earnings add column if not exists source text;
alter table public.creator_earnings add column if not exists post_id uuid;
alter table public.browsing_history add column if not exists post_id uuid;
alter table public.browsing_history add column if not exists view_type text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists verified boolean default false;
alter table public.profiles add column if not exists website text;
alter table public.stories add column if not exists user_id uuid;
alter table public.stories add column if not exists media_url text;
alter table public.stories add column if not exists media_type text;
alter table public.stories add column if not exists views_count bigint default 0;
alter table public.posts add column if not exists fund_earnings_paid boolean default false;

update public.creator_earnings set user_id=creator_id where user_id is null;
update public.creator_earnings set source=source_type where source is null;
update public.creator_earnings set post_id=source_id where post_id is null and source_type in ('tips','content_sales');
update public.browsing_history set post_id=entity_id,view_type='post' where entity_type='post' and post_id is null;
update public.profiles set full_name=display_name where full_name is null;
update public.profiles set verified=(verified_tier is not null and verified_tier<>'none') where verified is null;
update public.profiles set website=website_url where website is null;
update public.stories s set user_id=s.owner_id where s.user_id is null;
update public.stories s set media_url=m.media_url,media_type=m.media_type from public.media_assets m where m.id=s.media_asset_id and (s.media_url is null or s.media_type is null);
update public.stories set views_count=coalesce((metadata->>'views_count')::bigint,0) where views_count=0;
update public.conversations c set participant_1=x.p1,participant_2=x.p2 from (select conversation_id,(array_agg(user_id order by joined_at,user_id))[1] p1,(array_agg(user_id order by joined_at,user_id))[2] p2 from public.conversation_members where left_at is null group by conversation_id) x where c.id=x.conversation_id;

create or replace function public.sync_legacy_compat_columns() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='creator_earnings' then new.user_id:=coalesce(new.user_id,new.creator_id);new.source:=coalesce(new.source,new.source_type);new.post_id:=coalesce(new.post_id,new.source_id);
 elsif tg_table_name='browsing_history' then if new.entity_type='post' then new.post_id:=coalesce(new.post_id,new.entity_id);new.view_type:=coalesce(new.view_type,'post');end if;
 elsif tg_table_name='profiles' then new.full_name:=coalesce(new.full_name,new.display_name);new.verified:=coalesce(new.verified,(new.verified_tier is not null and new.verified_tier<>'none'));new.website:=coalesce(new.website,new.website_url);
 elsif tg_table_name='stories' then new.user_id:=coalesce(new.user_id,new.owner_id);new.views_count:=coalesce(new.views_count,coalesce((new.metadata->>'views_count')::bigint,0));end if;return new;end $$;
drop trigger if exists sync_creator_earnings_legacy on public.creator_earnings;
create trigger sync_creator_earnings_legacy before insert or update on public.creator_earnings for each row execute function public.sync_legacy_compat_columns();
drop trigger if exists sync_browsing_history_legacy on public.browsing_history;
create trigger sync_browsing_history_legacy before insert or update on public.browsing_history for each row execute function public.sync_legacy_compat_columns();
drop trigger if exists sync_profiles_legacy on public.profiles;
create trigger sync_profiles_legacy before insert or update on public.profiles for each row execute function public.sync_legacy_compat_columns();
drop trigger if exists sync_stories_legacy on public.stories;
create trigger sync_stories_legacy before insert or update on public.stories for each row execute function public.sync_legacy_compat_columns();

create or replace function public.sync_conversation_legacy_participants() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a uuid;b uuid;begin
 select (array_agg(user_id order by joined_at,user_id))[1],(array_agg(user_id order by joined_at,user_id))[2] into a,b from public.conversation_members where conversation_id=coalesce(new.conversation_id,old.conversation_id) and left_at is null;
 update public.conversations set participant_1=a,participant_2=b where id=coalesce(new.conversation_id,old.conversation_id);return coalesce(new,old);end $$;
drop trigger if exists sync_conversation_legacy_participants on public.conversation_members;
create trigger sync_conversation_legacy_participants after insert or update or delete on public.conversation_members for each row execute function public.sync_conversation_legacy_participants();
