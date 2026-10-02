#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL}"
: "${TARGET_DB_URL:?Set TARGET_DB_URL}"
command -v psql >/dev/null || { echo "psql is required"; exit 1; }

compare() {
  local table="$1"
  local src dst
  src=$(psql "$SOURCE_DB_URL" -Atc "select count(*) from public.\"$table\";")
  dst=$(psql "$TARGET_DB_URL" -Atc "select count(*) from public.\"$table\";")
  [[ "$src" == "$dst" ]] || { echo "MISMATCH $table source=$src target=$dst"; exit 2; }
  echo "OK $table=$src"
}

for table in profiles posts replies reposts bookmarks post_reactions media_assets federated_actors federated_objects federated_activities activitypub_keys; do
  compare "$table"
done

src=$(psql "$SOURCE_DB_URL" -Atc "select count(*) from auth.users;")
dst=$(psql "$TARGET_DB_URL" -Atc "select count(*) from auth.users;")
[[ "$src" == "$dst" ]] || { echo "MISMATCH auth.users source=$src target=$dst"; exit 2; }

src=$(psql "$SOURCE_DB_URL" -Atc "select count(*) from information_schema.table_constraints where constraint_schema='public' and constraint_type='FOREIGN KEY';")
dst=$(psql "$TARGET_DB_URL" -Atc "select count(*) from information_schema.table_constraints where constraint_schema='public' and constraint_type='FOREIGN KEY';")
[[ "$src" == "$dst" ]] || { echo "MISMATCH public FK count source=$src target=$dst"; exit 2; }

src=$(psql "$SOURCE_DB_URL" -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;")
dst=$(psql "$TARGET_DB_URL" -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;")
[[ "$src" == "$dst" ]] || { echo "MISMATCH RLS table count source=$src target=$dst"; exit 2; }

psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -Atc "
select count(*) from public.posts p
left join public.profiles pr on pr.id=coalesce(p.author_id,p.user_id)
where pr.id is null;
" | grep -qx '0' || { echo "Broken post->profile references"; exit 2; }

psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -Atc "
select count(*) from public.replies r
left join public.posts p on p.id=r.post_id
where p.id is null;
" | grep -qx '0' || { echo "Broken reply->post references"; exit 2; }

psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -Atc "
select count(*) from public.posts q
left join public.posts origin on origin.id=q.quoted_post_id
where q.quoted_post_id is not null and origin.id is null;
" | grep -qx '0' || { echo "Broken quote->origin references"; exit 2; }

echo "DATABASE VERIFICATION PASSED"
