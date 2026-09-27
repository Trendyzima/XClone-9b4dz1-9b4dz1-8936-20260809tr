-- Multimillion-user scale foundation: search, federation, queues, and feed access paths.
create extension if not exists pg_trgm;

create index if not exists profiles_username_trgm_idx on public.profiles using gin (lower(username) gin_trgm_ops) where account_status='active' and discoverable_by_username=true;
create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (lower(coalesce(display_name,'')) gin_trgm_ops) where account_status='active' and discoverable_by_username=true;
create index if not exists profiles_bio_trgm_idx on public.profiles using gin (lower(coalesce(bio,'')) gin_trgm_ops) where account_status='active' and discoverable_by_username=true;
create index if not exists federated_actors_username_trgm_idx on public.federated_actors using gin (lower(coalesce(username,'')) gin_trgm_ops);
create index if not exists federated_actors_display_name_trgm_idx on public.federated_actors using gin (lower(coalesce(display_name,'')) gin_trgm_ops);
create index if not exists federated_actors_bio_trgm_idx on public.federated_actors using gin (lower(coalesce(bio,'')) gin_trgm_ops);
create index if not exists federated_actors_domain_trgm_idx on public.federated_actors using gin (lower(coalesce(domain,'')) gin_trgm_ops);
create index if not exists posts_content_trgm_idx on public.posts using gin (lower(coalesce(content,'')) gin_trgm_ops) where deleted_at is null;
create index if not exists federated_objects_content_trgm_idx on public.federated_objects using gin (lower(coalesce(content,'')) gin_trgm_ops) where deleted_at is null and tombstone=false;
create index if not exists federated_objects_summary_trgm_idx on public.federated_objects using gin (lower(coalesce(summary,'')) gin_trgm_ops) where deleted_at is null and tombstone=false;
create index if not exists federated_objects_actor_published_idx on public.federated_objects (actor_uri, published_at desc) where deleted_at is null and tombstone=false;
create index if not exists federated_objects_instance_published_idx on public.federated_objects (instance_id, published_at desc) where deleted_at is null and tombstone=false;
create index if not exists federated_objects_tags_gin_idx on public.federated_objects using gin (tags jsonb_path_ops) where deleted_at is null and tombstone=false;
create index if not exists federated_hashtag_mentions_hashtag_object_idx on public.federated_hashtag_mentions (hashtag_id, object_id);
create index if not exists federated_hashtag_mentions_object_hashtag_idx on public.federated_hashtag_mentions (object_id, hashtag_id);
create index if not exists federated_reactions_object_created_idx on public.federated_reactions (object_id, created_at desc);
create index if not exists federated_activities_processing_queue_idx on public.federated_activities (processing_state, created_at) where processing_state in ('pending','retry','processing');
create index if not exists activitypub_inbox_processing_queue_idx on public.activitypub_inbox (processed, expires_at, created_at) where processed=false;
create index if not exists activitypub_outbox_delivery_queue_idx on public.activitypub_outbox (delivered, next_attempt_at, expires_at) where delivered=false;
create index if not exists federation_deliveries_retry_queue_idx on public.federation_deliveries (status, next_attempt_at, locked_at) where status in ('pending','retry','processing');
create index if not exists follows_follower_status_following_idx on public.follows (follower_id, status, following_id);
create index if not exists follows_following_status_follower_idx on public.follows (following_id, status, follower_id);
create index if not exists post_reactions_user_created_post_idx on public.post_reactions (user_id, created_at desc, post_id);
create index if not exists browsing_history_user_entity_created_idx on public.browsing_history (user_id, entity_type, created_at desc, entity_id);
