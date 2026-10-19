-- Atomic source producers for public XClone account profiles and posts.
-- These triggers only write the local durable outbox; they never call the peer.
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_replication_source_versions (
  origin TEXT NOT NULL CHECK (origin = 'xclone'),
  entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 128),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  current_version BIGINT NOT NULL CHECK (current_version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (origin, entity_type, entity_id)
);

REVOKE ALL ON public.platform_replication_source_versions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_platform_replication_source_version(
  p_entity_type TEXT, p_entity_id TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $source$
DECLARE v_version BIGINT;
BEGIN
  IF p_entity_type !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR p_entity_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid_replication_entity_identity' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_replication_source_versions
    (origin, entity_type, entity_id, current_version)
  VALUES ('xclone', p_entity_type, p_entity_id, 1)
  ON CONFLICT (origin, entity_type, entity_id) DO UPDATE
    SET current_version = public.platform_replication_source_versions.current_version + 1,
        updated_at = now()
  RETURNING current_version INTO v_version;
  RETURN v_version;
END;
$source$;

REVOKE ALL ON FUNCTION public.next_platform_replication_source_version(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_public_post_replication_event(
  p_row JSONB, p_event_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $source$
DECLARE
  v_id TEXT := p_row->>'id';
  v_version BIGINT;
  v_payload JSONB;
BEGIN
  IF p_event_type NOT IN ('post.created', 'post.updated', 'post.deleted') THEN
    RAISE EXCEPTION 'invalid_post_replication_event_type' USING ERRCODE = '22023';
  END IF;
  IF p_event_type = 'post.deleted' THEN
    v_payload := '{}'::jsonb;
  ELSE
    v_payload := jsonb_build_object(
      'id', v_id,
      'author_id', coalesce(p_row->>'author_id', p_row->>'user_id'),
      'text', coalesce(p_row->>'content', p_row->>'body', ''),
      'content', coalesce(p_row->>'content', p_row->>'body', ''),
      'visibility', 'public',
      'created_at', p_row->>'created_at',
      'updated_at', coalesce(p_row->>'updated_at', p_row->>'created_at')
    );
  END IF;
  v_version := public.next_platform_replication_source_version('post', v_id);
  PERFORM public.enqueue_platform_replication_event(jsonb_build_object(
    'id', gen_random_uuid(),
    'origin', 'xclone',
    'entity_type', 'post',
    'entity_id', v_id,
    'entity_version', v_version,
    'schema_version', 1,
    'event_type', p_event_type,
    'occurred_at', now(),
    'payload', v_payload
  ));
END;
$source$;

REVOKE ALL ON FUNCTION public.enqueue_public_post_replication_event(JSONB, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.replicate_public_post_after_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $source$
DECLARE
  old_row JSONB;
  new_row JSONB;
  was_public BOOLEAN := FALSE;
  is_public BOOLEAN := FALSE;
  author_id TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

  IF old_row IS NOT NULL THEN
    author_id := coalesce(old_row->>'author_id', old_row->>'user_id');
    was_public := old_row->>'visibility' = 'public'
      AND nullif(old_row->>'community_id', '') IS NULL
      AND nullif(old_row->>'deleted_at', '') IS NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id::text = author_id
          AND coalesce(p.account_status, 'active') = 'active'
          AND coalesce(p.discoverable_by_username, TRUE)
          AND NOT coalesce(p.protected_account, FALSE)
      );
  END IF;

  IF new_row IS NOT NULL THEN
    author_id := coalesce(new_row->>'author_id', new_row->>'user_id');
    is_public := new_row->>'visibility' = 'public'
      AND nullif(new_row->>'community_id', '') IS NULL
      AND nullif(new_row->>'deleted_at', '') IS NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id::text = author_id
          AND coalesce(p.account_status, 'active') = 'active'
          AND coalesce(p.discoverable_by_username, TRUE)
          AND NOT coalesce(p.protected_account, FALSE)
      );
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF is_public THEN PERFORM public.enqueue_public_post_replication_event(new_row, 'post.created'); END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF was_public THEN PERFORM public.enqueue_public_post_replication_event(old_row, 'post.deleted'); END IF;
    RETURN OLD;
  END IF;

  IF was_public AND NOT is_public THEN
    PERFORM public.enqueue_public_post_replication_event(old_row, 'post.deleted');
  ELSIF NOT was_public AND is_public THEN
    PERFORM public.enqueue_public_post_replication_event(new_row, 'post.created');
  ELSIF was_public AND is_public AND (
    old_row->>'content' IS DISTINCT FROM new_row->>'content'
    OR old_row->>'body' IS DISTINCT FROM new_row->>'body'
    OR old_row->>'visibility' IS DISTINCT FROM new_row->>'visibility'
    OR old_row->>'community_id' IS DISTINCT FROM new_row->>'community_id'
    OR coalesce(old_row->>'author_id', old_row->>'user_id') IS DISTINCT FROM coalesce(new_row->>'author_id', new_row->>'user_id')
  ) THEN
    PERFORM public.enqueue_public_post_replication_event(new_row, 'post.updated');
  END IF;
  RETURN NEW;
END;
$source$;

DROP TRIGGER IF EXISTS posts_replication_public_projection ON public.posts;
CREATE TRIGGER posts_replication_public_projection
AFTER INSERT OR UPDATE OR DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.replicate_public_post_after_write();

CREATE OR REPLACE FUNCTION public.enqueue_public_profile_replication_event(
  p_row JSONB, p_event_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $source$
DECLARE
  v_id TEXT := p_row->>'id';
  v_version BIGINT;
  v_avatar TEXT := p_row->>'avatar_url';
  v_payload JSONB;
BEGIN
  IF p_event_type NOT IN ('account.profile.created', 'account.profile.updated', 'account.profile.deleted') THEN
    RAISE EXCEPTION 'invalid_profile_replication_event_type' USING ERRCODE = '22023';
  END IF;
  IF p_event_type = 'account.profile.deleted' THEN
    v_payload := '{}'::jsonb;
  ELSE
    IF v_avatar IS NOT NULL AND (
      v_avatar !~ '^https://[^/?#]+[^?#]*$'
      OR position('@' in split_part(v_avatar, '/', 3)) > 0
      OR position('?' in v_avatar) > 0
      OR position('#' in v_avatar) > 0
    ) THEN
      v_avatar := NULL;
    END IF;
    v_payload := jsonb_build_object(
      'id', v_id,
      'username', p_row->>'username',
      'display_name', p_row->>'display_name',
      'bio', p_row->>'bio',
      'avatar_url', v_avatar
    );
  END IF;
  v_version := public.next_platform_replication_source_version('account', v_id);
  PERFORM public.enqueue_platform_replication_event(jsonb_build_object(
    'id', gen_random_uuid(),
    'origin', 'xclone',
    'entity_type', 'account',
    'entity_id', v_id,
    'entity_version', v_version,
    'schema_version', 1,
    'event_type', p_event_type,
    'occurred_at', now(),
    'payload', v_payload
  ));
END;
$source$;

REVOKE ALL ON FUNCTION public.enqueue_public_profile_replication_event(JSONB, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.replicate_public_profile_after_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $source$
DECLARE
  old_row JSONB;
  new_row JSONB;
  was_public BOOLEAN := FALSE;
  is_public BOOLEAN := FALSE;
  profile_id TEXT;
  old_protected BOOLEAN := FALSE;
  new_protected BOOLEAN := FALSE;
  post_row JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

  IF old_row IS NOT NULL THEN
    was_public := coalesce(old_row->>'account_status', 'active') = 'active'
      AND coalesce((old_row->>'discoverable_by_username')::boolean, TRUE);
    old_protected := coalesce((old_row->>'protected_account')::boolean, FALSE);
  END IF;
  IF new_row IS NOT NULL THEN
    is_public := coalesce(new_row->>'account_status', 'active') = 'active'
      AND coalesce((new_row->>'discoverable_by_username')::boolean, TRUE);
    new_protected := coalesce((new_row->>'protected_account')::boolean, FALSE);
  END IF;

  profile_id := coalesce(new_row->>'id', old_row->>'id');

  IF TG_OP = 'INSERT' THEN
    IF is_public THEN PERFORM public.enqueue_public_profile_replication_event(new_row, 'account.profile.created'); END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF was_public THEN
      PERFORM public.enqueue_public_profile_replication_event(old_row, 'account.profile.deleted');
      FOR post_row IN
        SELECT to_jsonb(p) FROM public.posts p
        WHERE coalesce(p.author_id, p.user_id)::text = profile_id
          AND p.visibility = 'public' AND p.community_id IS NULL AND p.deleted_at IS NULL
      LOOP
        PERFORM public.enqueue_public_post_replication_event(post_row, 'post.deleted');
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;

  IF was_public AND NOT is_public THEN
    PERFORM public.enqueue_public_profile_replication_event(old_row, 'account.profile.deleted');
    FOR post_row IN
      SELECT to_jsonb(p) FROM public.posts p
      WHERE coalesce(p.author_id, p.user_id)::text = profile_id
        AND p.visibility = 'public' AND p.community_id IS NULL AND p.deleted_at IS NULL
    LOOP
      PERFORM public.enqueue_public_post_replication_event(post_row, 'post.deleted');
    END LOOP;
  ELSIF NOT was_public AND is_public THEN
    PERFORM public.enqueue_public_profile_replication_event(new_row, 'account.profile.created');
    IF NOT new_protected THEN
      FOR post_row IN
        SELECT to_jsonb(p) FROM public.posts p
        WHERE coalesce(p.author_id, p.user_id)::text = profile_id
          AND p.visibility = 'public' AND p.community_id IS NULL AND p.deleted_at IS NULL
      LOOP
        PERFORM public.enqueue_public_post_replication_event(post_row, 'post.created');
      END LOOP;
    END IF;
  ELSIF was_public AND is_public THEN
    IF old_protected IS DISTINCT FROM new_protected THEN
      FOR post_row IN
        SELECT to_jsonb(p) FROM public.posts p
        WHERE coalesce(p.author_id, p.user_id)::text = profile_id
          AND p.visibility = 'public' AND p.community_id IS NULL AND p.deleted_at IS NULL
      LOOP
        PERFORM public.enqueue_public_post_replication_event(
          post_row, CASE WHEN new_protected THEN 'post.deleted' ELSE 'post.created' END
        );
      END LOOP;
    END IF;
    IF old_row->>'username' IS DISTINCT FROM new_row->>'username'
       OR old_row->>'display_name' IS DISTINCT FROM new_row->>'display_name'
       OR old_row->>'bio' IS DISTINCT FROM new_row->>'bio'
       OR old_row->>'avatar_url' IS DISTINCT FROM new_row->>'avatar_url' THEN
      PERFORM public.enqueue_public_profile_replication_event(new_row, 'account.profile.updated');
    END IF;
  END IF;
  RETURN NEW;
END;
$source$;

DROP TRIGGER IF EXISTS profiles_replication_public_projection ON public.profiles;
CREATE TRIGGER profiles_replication_public_projection
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.replicate_public_profile_after_write();

COMMIT;
