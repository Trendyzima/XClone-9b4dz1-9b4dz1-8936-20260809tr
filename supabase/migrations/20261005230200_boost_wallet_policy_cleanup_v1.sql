begin;
drop policy if exists boosts_owner_read on public.boosts;
drop policy if exists boosts_owner_update on public.boosts;
create index if not exists boosts_created_by_idx on public.boosts(created_by);
commit;