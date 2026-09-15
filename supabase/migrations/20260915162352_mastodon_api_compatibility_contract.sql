-- Mastodon compatibility contract: OAuth token lookup, pagination/search indexes,
-- and serverless API access. Keep RLS enabled; service-side Edge Functions are
-- the only privileged path used by the Mastodon compatibility layer.
alter table public.fediverse_oauth_codes alter column user_id drop not null;
create index if not exists fediverse_oauth_codes_access_token_idx on public.fediverse_oauth_codes(access_token);
create index if not exists fediverse_oauth_codes_client_user_idx on public.fediverse_oauth_codes(client_id,user_id);
create index if not exists posts_public_created_idx on public.posts(created_at desc,id desc) where deleted_at is null;
create index if not exists posts_author_created_idx on public.posts(author_id,created_at desc,id desc) where deleted_at is null;
create index if not exists federated_objects_published_idx on public.federated_objects(published_at desc,uri desc) where deleted_at is null and tombstone=false;
create index if not exists federated_actors_username_idx on public.federated_actors(username);
create index if not exists federated_actors_preferred_username_idx on public.federated_actors(preferred_username);
