create schema if not exists private;

create table if not exists public.community_notes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null,
  text text not null check (char_length(btrim(text)) between 20 and 1000),
  status text not null default 'needs_ratings' check (status in ('needs_ratings','published','rejected','hidden')),
  helpful_score numeric(8,5) not null default 0,
  rating_count integer not null default 0,
  distinct_rater_count integer not null default 0,
  perspective_count integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, author_id, text)
);

create table if not exists public.community_note_ratings (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.community_notes(id) on delete cascade,
  rater_id uuid not null,
  helpful boolean not null,
  perspective text not null default 'general' check (perspective in ('general','technical','local','lived_experience','subject_matter','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (note_id, rater_id)
);

create table if not exists public.community_note_contributors (
  user_id uuid primary key,
  enrolled boolean not null default true,
  ratings_given integer not null default 0,
  helpful_ratings integer not null default 0,
  perspective text not null default 'general' check (perspective in ('general','technical','local','lived_experience','subject_matter','other')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_notes_post_status_idx on public.community_notes(post_id,status,published_at desc);
create index if not exists community_notes_author_idx on public.community_notes(author_id,created_at desc);
create index if not exists community_note_ratings_note_idx on public.community_note_ratings(note_id,created_at desc);
create index if not exists community_note_ratings_rater_idx on public.community_note_ratings(rater_id,created_at desc);

alter table public.community_notes enable row level security;
alter table public.community_note_ratings enable row level security;
alter table public.community_note_contributors enable row level security;

create policy community_notes_public_read on public.community_notes for select to authenticated using (status = 'published' or author_id = (select auth.uid()));
create policy community_notes_insert_own on public.community_notes for insert to authenticated with check (author_id = (select auth.uid()));
create policy community_notes_update_own on public.community_notes for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy community_note_ratings_own_read on public.community_note_ratings for select to authenticated using (rater_id = (select auth.uid()));
create policy community_note_ratings_insert_own on public.community_note_ratings for insert to authenticated with check (rater_id = (select auth.uid()));
create policy community_note_ratings_update_own on public.community_note_ratings for update to authenticated using (rater_id = (select auth.uid())) with check (rater_id = (select auth.uid()));
create policy community_note_contributors_own on public.community_note_contributors for select to authenticated using (user_id = (select auth.uid()));
create policy community_note_contributors_insert_own on public.community_note_contributors for insert to authenticated with check (user_id = (select auth.uid()));
create policy community_note_contributors_update_own on public.community_note_contributors for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function private.refresh_community_note_score(p_note_id uuid)
returns void language plpgsql security definer set search_path = public, private
as $$
declare v_total integer; v_helpful integer; v_distinct integer; v_perspectives integer; v_score numeric; v_status text;
begin
  select count(*), count(*) filter (where helpful), count(distinct rater_id), count(distinct perspective)
    into v_total, v_helpful, v_distinct, v_perspectives
  from public.community_note_ratings where note_id = p_note_id;
  if v_total = 0 then v_score := 0; else v_score := (v_helpful + 2.0 * 0.5) / (v_total + 2.0); end if;
  if v_total >= 5 and v_score >= 0.70 and v_distinct >= 4 and v_perspectives >= 2 then v_status := 'published';
  elsif v_total >= 12 and v_score < 0.40 then v_status := 'rejected';
  else v_status := 'needs_ratings'; end if;
  update public.community_notes set helpful_score=v_score, rating_count=v_total, distinct_rater_count=v_distinct, perspective_count=v_perspectives,
    status=case when status='hidden' then 'hidden' else v_status end,
    published_at=case when v_status='published' and published_at is null then now() else published_at end, updated_at=now()
  where id=p_note_id;
end;
$$;
revoke all on function private.refresh_community_note_score(uuid) from public, anon, authenticated;

create or replace function private.community_note_rating_trigger()
returns trigger language plpgsql security definer set search_path = public, private
as $$
declare v_note uuid; v_rater uuid;
begin
  v_note := coalesce(new.note_id, old.note_id); v_rater := coalesce(new.rater_id, old.rater_id);
  insert into public.community_note_contributors(user_id) values(v_rater) on conflict (user_id) do nothing;
  update public.community_note_contributors c set ratings_given=(select count(*) from public.community_note_ratings r where r.rater_id=c.user_id), helpful_ratings=(select count(*) from public.community_note_ratings r where r.rater_id=c.user_id and r.helpful), updated_at=now() where c.user_id=v_rater;
  perform private.refresh_community_note_score(v_note);
  return coalesce(new, old);
end;
$$;
revoke all on function private.community_note_rating_trigger() from public, anon, authenticated;

drop trigger if exists community_note_rating_score on public.community_note_ratings;
create trigger community_note_rating_score after insert or update or delete on public.community_note_ratings for each row execute function private.community_note_rating_trigger();

create or replace function public.get_post_community_notes(p_post_id uuid)
returns table(id uuid, post_id uuid, author_id uuid, text text, status text, helpful_score numeric, rating_count integer, distinct_rater_count integer, perspective_count integer, published_at timestamptz, created_at timestamptz)
language sql security invoker set search_path = public
as $$
  select n.id,n.post_id,n.author_id,n.text,n.status,n.helpful_score,n.rating_count,n.distinct_rater_count,n.perspective_count,n.published_at,n.created_at
  from public.community_notes n
  where n.post_id=p_post_id and (n.status='published' or n.author_id=(select auth.uid()))
  order by case when n.status='published' then 0 else 1 end, n.helpful_score desc, n.created_at desc;
$$;
revoke all on function public.get_post_community_notes(uuid) from public, anon;
grant execute on function public.get_post_community_notes(uuid) to authenticated;
grant select, insert, update on public.community_notes to authenticated;
grant select, insert, update on public.community_note_ratings to authenticated;
grant select, insert, update on public.community_note_contributors to authenticated;
