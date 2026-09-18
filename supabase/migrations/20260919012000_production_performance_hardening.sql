-- Production performance hardening.
-- Action key: db.performance.harden
-- Reverse key: db.performance.harden.rollback
-- Adds missing foreign-key indexes, caches auth.uid() in RLS initplans,
-- and removes redundant permissive SELECT overlap without changing access intent.

DO $$
DECLARE r record; idx text;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
           string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord) AS cols
    FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY u(attnum,ord) ON true
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.attnum
    WHERE con.contype='f' AND n.nspname='public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid=c.oid AND i.indisvalid AND i.indpred IS NULL
          AND (i.indkey::smallint[])[1:cardinality(con.conkey)] =
              (SELECT array_agg(x.attnum ORDER BY z.ord)::smallint[]
               FROM unnest(con.conkey) WITH ORDINALITY z(attnum,ord)
               JOIN pg_attribute x ON x.attrelid=c.oid AND x.attnum=z.attnum)
      )
    GROUP BY n.nspname,c.relname,con.conname
  LOOP
    idx := left(r.table_name || '_' || regexp_replace(r.constraint_name,'_fkey$','') || '_idx', 63);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)', idx, r.schema_name, r.table_name, r.cols);
  END LOOP;
END $$;

DO $$
DECLARE r record; new_qual text; new_check text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies WHERE schemaname='public'
      AND (coalesce(qual,'') LIKE '%auth.uid()%' OR coalesce(with_check,'') LIKE '%auth.uid()%')
  LOOP
    new_qual := regexp_replace(coalesce(r.qual,''), 'auth\.uid\(\)', '(select auth.uid())', 'g');
    new_check := regexp_replace(coalesce(r.with_check,''), 'auth\.uid\(\)', '(select auth.uid())', 'g');
    IF r.qual IS NOT NULL AND new_qual <> r.qual THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', r.policyname, r.schemaname, r.tablename, new_qual);
    END IF;
    IF r.with_check IS NOT NULL AND new_check <> r.with_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', r.policyname, r.schemaname, r.tablename, new_check);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS communities_owner ON public.communities;
CREATE POLICY communities_owner ON public.communities FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY communities_owner_update ON public.communities FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY communities_owner_delete ON public.communities FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS post_hashtags_owner ON public.post_hashtags;
CREATE POLICY post_hashtags_owner ON public.post_hashtags FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_hashtags.post_id AND p.user_id = (select auth.uid())));
CREATE POLICY post_hashtags_owner_update ON public.post_hashtags FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_hashtags.post_id AND p.user_id = (select auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_hashtags.post_id AND p.user_id = (select auth.uid())));
CREATE POLICY post_hashtags_owner_delete ON public.post_hashtags FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_hashtags.post_id AND p.user_id = (select auth.uid())));

DROP POLICY IF EXISTS spaces_owner ON public.spaces;
CREATE POLICY spaces_owner ON public.spaces FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = host_id);
CREATE POLICY spaces_owner_update ON public.spaces FOR UPDATE TO authenticated USING ((select auth.uid()) = host_id) WITH CHECK ((select auth.uid()) = host_id);
CREATE POLICY spaces_owner_delete ON public.spaces FOR DELETE TO authenticated USING ((select auth.uid()) = host_id);
