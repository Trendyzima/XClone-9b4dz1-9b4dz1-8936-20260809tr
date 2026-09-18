-- Cleanup for foreign-key indexes missed by the generic production hardening pass.
-- Action key: db.performance.fk_gap_cleanup
-- Reverse key: db.performance.fk_gap_cleanup.rollback
CREATE INDEX IF NOT EXISTS blocks_blocked_id_idx ON public.blocks (blocked_id);
CREATE INDEX IF NOT EXISTS bookmarks_post_id_idx ON public.bookmarks (post_id);
CREATE INDEX IF NOT EXISTS call_participants_user_id_idx ON public.call_participants (user_id);
CREATE INDEX IF NOT EXISTS challenge_entries_user_id_idx ON public.challenge_entries (user_id);
CREATE INDEX IF NOT EXISTS community_members_user_id_idx ON public.community_members (user_id);
CREATE INDEX IF NOT EXISTS list_members_user_id_idx ON public.list_members (user_id);
CREATE INDEX IF NOT EXISTS live_space_members_user_id_idx ON public.live_space_members (user_id);
CREATE INDEX IF NOT EXISTS message_reactions_user_id_idx ON public.message_reactions (user_id);
CREATE INDEX IF NOT EXISTS mutes_muted_id_idx ON public.mutes (muted_id);
CREATE INDEX IF NOT EXISTS post_hashtags_hashtag_id_idx ON public.post_hashtags (hashtag_id);
CREATE INDEX IF NOT EXISTS post_series_items_post_id_idx ON public.post_series_items (post_id);
CREATE INDEX IF NOT EXISTS reposts_user_id_idx ON public.reposts (user_id);
CREATE INDEX IF NOT EXISTS series_posts_post_id_idx ON public.series_posts (post_id);
CREATE INDEX IF NOT EXISTS space_participants_user_id_idx ON public.space_participants (user_id);
CREATE INDEX IF NOT EXISTS story_views_viewer_id_idx ON public.story_views (viewer_id);
CREATE INDEX IF NOT EXISTS typing_indicators_user_id_idx ON public.typing_indicators (user_id);
CREATE INDEX IF NOT EXISTS user_interests_hashtag_id_idx ON public.user_interests (hashtag_id);
CREATE INDEX IF NOT EXISTS user_suggestions_suggested_user_id_idx ON public.user_suggestions (suggested_user_id);
CREATE INDEX IF NOT EXISTS wishlists_product_id_idx ON public.wishlists (product_id);
DROP INDEX IF EXISTS public.media_assets_media_assets_post_id_idx;
DROP INDEX IF EXISTS public.notifications_notifications_actor_id_idx;
DROP INDEX IF EXISTS public.notifications_notifications_post_id_idx;
DROP INDEX IF EXISTS public.post_media_post_media_owner_id_idx;