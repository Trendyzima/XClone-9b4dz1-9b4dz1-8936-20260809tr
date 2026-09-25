-- Public discovery surfaces must remain readable before authentication while preserving RLS.
drop policy if exists hashtags_public_read on public.hashtags;
create policy hashtags_public_read on public.hashtags for select to anon using (true);
drop policy if exists trending_topics_public_read on public.trending_topics;
create policy trending_topics_public_read on public.trending_topics for select to anon using (true);
drop policy if exists communities_public_read on public.communities;
create policy communities_public_read on public.communities for select to anon using (visibility='public');
