-- Every Testagram audio/TV channel gets a first-class profile automatically.
create table if not exists public.channel_profiles (
 id uuid primary key default gen_random_uuid(), channel_key text not null unique,
 channel_type text not null check(channel_type in('audio','tv','video')), source_id uuid not null,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 handle text not null unique, name text not null, bio text, avatar_url text, banner_url text,
 category text, follower_count bigint not null default 0 check(follower_count>=0),
 following_count bigint not null default 0 check(following_count>=0), is_verified boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists channel_profiles_owner_idx on public.channel_profiles(owner_id);
create index if not exists channel_profiles_type_idx on public.channel_profiles(channel_type,created_at desc);
alter table public.channel_profiles enable row level security;
drop policy if exists channel_profiles_public_read on public.channel_profiles;
create policy channel_profiles_public_read on public.channel_profiles for select to anon,authenticated using(true);
drop policy if exists channel_profiles_owner_update on public.channel_profiles;
create policy channel_profiles_owner_update on public.channel_profiles for update to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
grant select on public.channel_profiles to anon,authenticated;
grant update on public.channel_profiles to authenticated;
create or replace function public.channel_profile_handle(p_name text,p_type text,p_id uuid) returns text language plpgsql immutable set search_path=public as $$
declare base text; begin base:=lower(regexp_replace(coalesce(nullif(trim(p_name),''),'channel'),'[^a-zA-Z0-9]+','-','g')); base:=trim(both '-' from base); if base='' then base:='channel'; end if; return left(base,42)||'-'||left(replace(p_id::text,'-',''),10); end $$;
create or replace function public.ensure_channel_profile(p_type text,p_source_id uuid,p_owner_id uuid,p_name text,p_category text default null,p_avatar_url text default null) returns public.channel_profiles language plpgsql security definer set search_path=public as $$
declare result public.channel_profiles; key text; h text;
begin key:=p_type||':'||p_source_id::text; h:=public.channel_profile_handle(p_name,p_type,p_source_id);
insert into public.channel_profiles(channel_key,channel_type,source_id,owner_id,handle,name,category,avatar_url)
values(key,p_type,p_source_id,p_owner_id,h,coalesce(nullif(trim(p_name),''),'Testagram Channel'),p_category,p_avatar_url)
on conflict(channel_key) do update set name=excluded.name,category=coalesce(excluded.category,channel_profiles.category),avatar_url=coalesce(excluded.avatar_url,channel_profiles.avatar_url),updated_at=now()
returning * into result; return result; end $$;
revoke all on function public.ensure_channel_profile(text,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.ensure_channel_profile(text,uuid,uuid,text,text,text) to authenticated;
create or replace function public.trg_auto_channel_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin if TG_TABLE_NAME='live_streams' then perform public.ensure_channel_profile('tv',new.id,new.user_id,new.title,new.category,new.thumbnail_url); elsif TG_TABLE_NAME='spaces' then perform public.ensure_channel_profile('audio',new.id,new.host_id,new.title,new.category,new.artwork_url); end if; return new; end $$;
drop trigger if exists auto_tv_channel_profile on public.live_streams;
create trigger auto_tv_channel_profile after insert on public.live_streams for each row execute function public.trg_auto_channel_profile();
drop trigger if exists auto_audio_channel_profile on public.spaces;
create trigger auto_audio_channel_profile after insert on public.spaces for each row execute function public.trg_auto_channel_profile();
insert into public.channel_profiles(channel_key,channel_type,source_id,owner_id,handle,name,category,avatar_url)
select 'tv:'||s.id,'tv',s.id,s.user_id,public.channel_profile_handle(s.title,'tv',s.id),coalesce(nullif(trim(s.title),''),'Testagram TV Channel'),s.category,s.thumbnail_url from public.live_streams s on conflict(channel_key) do nothing;
insert into public.channel_profiles(channel_key,channel_type,source_id,owner_id,handle,name,category,avatar_url)
select 'audio:'||s.id,'audio',s.id,s.host_id,public.channel_profile_handle(s.title,'audio',s.id),coalesce(nullif(trim(s.title),''),'Testagram Audio Channel'),s.category,s.artwork_url from public.spaces s on conflict(channel_key) do nothing;
notify pgrst,'reload schema';