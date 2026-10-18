-- Older deployed clients embed public.profiles through the historical
-- threads_owner_id_fkey name. That constraint currently points at auth.users,
-- so PostgREST rejects the embed with HTTP 400. Preserve user ownership
-- integrity under a new name and restore the expected profile relationship.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.threads'::regclass
      AND conname = 'threads_owner_id_fkey'
      AND confrelid = 'auth.users'::regclass
  ) THEN
    ALTER TABLE public.threads
      RENAME CONSTRAINT threads_owner_id_fkey
      TO threads_owner_auth_user_id_fkey;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.threads'::regclass
      AND conname = 'threads_owner_id_fkey'
      AND confrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.threads
      ADD CONSTRAINT threads_owner_id_fkey
      FOREIGN KEY (owner_id)
      REFERENCES public.profiles(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.threads
  VALIDATE CONSTRAINT threads_owner_id_fkey;

NOTIFY pgrst, 'reload schema';
