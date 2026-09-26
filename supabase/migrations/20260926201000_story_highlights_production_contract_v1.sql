-- Production contract for profile story highlights.
create table if not exists public.user_highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 30),
  cover_url text,
  story_ids uuid[] not null default '{}'::uuid[],
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_highlights_user_sort_idx
  on public.user_highlights(user_id, sort_order, created_at desc);

alter table public.user_highlights enable row level security;

drop policy if exists user_highlights_select on public.user_highlights;
create policy user_highlights_select on public.user_highlights for select to authenticated using (true);

drop policy if exists user_highlights_insert on public.user_highlights;
create policy user_highlights_insert on public.user_highlights for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_highlights_update on public.user_highlights;
create policy user_highlights_update on public.user_highlights for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists user_highlights_delete on public.user_highlights;
create policy user_highlights_delete on public.user_highlights for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_user_highlights_updated_at()
returns trigger language plpgsql set search_path='public' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_highlights_updated_at on public.user_highlights;
create trigger user_highlights_updated_at
before update on public.user_highlights
for each row execute function public.set_user_highlights_updated_at();
