-- Secondary data-plane browser hardening.
-- Canonical user, financial, legal and transactional writes remain on the primary project.
-- Secondary is a public/read-heavy plane; trusted ingestion/replication is server-side only.

alter table public.posts enable row level security;
alter table public.products enable row level security;
alter table public.live_streams enable row level security;
alter table public.post_media enable row level security;
alter table public.trending_topics enable row level security;
alter table public.federated_objects enable row level security;
alter table public.federated_actors enable row level security;
alter table public.federated_instances enable row level security;

drop policy if exists secondary_posts_public_read on public.posts;
create policy secondary_posts_public_read on public.posts
  for select to anon, authenticated using (true);

drop policy if exists secondary_products_public_read on public.products;
create policy secondary_products_public_read on public.products
  for select to anon, authenticated using (true);

drop policy if exists secondary_live_streams_public_read on public.live_streams;
create policy secondary_live_streams_public_read on public.live_streams
  for select to anon, authenticated using (true);

drop policy if exists secondary_post_media_public_read on public.post_media;
create policy secondary_post_media_public_read on public.post_media
  for select to anon, authenticated using (true);

drop policy if exists secondary_trending_topics_public_read on public.trending_topics;
create policy secondary_trending_topics_public_read on public.trending_topics
  for select to anon, authenticated using (true);

drop policy if exists secondary_federated_objects_public_read on public.federated_objects;
create policy secondary_federated_objects_public_read on public.federated_objects
  for select to anon, authenticated using (true);

drop policy if exists secondary_federated_actors_public_read on public.federated_actors;
create policy secondary_federated_actors_public_read on public.federated_actors
  for select to anon, authenticated using (true);

drop policy if exists secondary_federated_instances_public_read on public.federated_instances;
create policy secondary_federated_instances_public_read on public.federated_instances
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.posts, public.products, public.live_streams,
  public.post_media, public.trending_topics, public.federated_objects,
  public.federated_actors, public.federated_instances from anon, authenticated;

grant select on public.posts, public.products, public.live_streams, public.post_media,
  public.trending_topics, public.federated_objects, public.federated_actors,
  public.federated_instances to anon, authenticated;
