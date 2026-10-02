-- Read-only migration preflight. Run on SOURCE and TARGET.
select public.backend_portability_manifest();
select count(*) as posts from public.posts;
select count(*) as replies from public.replies;
select count(*) as reposts from public.reposts;
select count(*) as bookmarks from public.bookmarks;
select count(*) as post_reactions from public.post_reactions;
select count(*) as media_assets from public.media_assets;
select count(*) as federated_actors from public.federated_actors;
select count(*) as federated_objects from public.federated_objects;
select count(*) as federated_activities from public.federated_activities;
select count(*) as activitypub_keys from public.activitypub_keys;
