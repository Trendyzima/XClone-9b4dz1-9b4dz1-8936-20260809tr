#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL}"
: "${TARGET_DB_URL:?Set TARGET_DB_URL}"
command -v psql >/dev/null || { echo "psql is required"; exit 1; }

sql() {
  psql "$1" -v ON_ERROR_STOP=1 -Atc "$2"
}

echo "== Global inventory =="
for metric in \
  "auth.users|select count(*) from auth.users" \
  "storage.buckets|select count(*) from storage.buckets" \
  "storage.objects|select count(*) from storage.objects" \
  "public foreign keys|select count(*) from information_schema.table_constraints where constraint_schema='public' and constraint_type='FOREIGN KEY'" \
  "public RLS tables|select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"
do
  name="${metric%%|*}"
  query="${metric#*|}"
  src=$(sql "$SOURCE_DB_URL" "$query")
  dst=$(sql "$TARGET_DB_URL" "$query")
  [[ "$src" == "$dst" ]] || { echo "MISMATCH $name source=$src target=$dst"; exit 2; }
  echo "OK $name=$src"
done

echo "== Every public application table =="
mapfile -t tables < <(sql "$SOURCE_DB_URL" "
  select table_name
  from information_schema.tables
  where table_schema='public'
    and table_type='BASE TABLE'
    and table_name not in ('backend_migration_runs')
  order by table_name;
")
for table in "${tables[@]}"; do
  src=$(sql "$SOURCE_DB_URL" "select count(*) from public.\"$table\";")
  dst=$(sql "$TARGET_DB_URL" "select count(*) from public.\"$table\";")
  [[ "$src" == "$dst" ]] || { echo "MISMATCH public.$table source=$src target=$dst"; exit 2; }
  echo "OK public.$table=$src"
done

echo "== Critical lineage/integrity checks =="
sql "$TARGET_DB_URL" "
select count(*) from public.posts p
left join public.profiles pr on pr.id=coalesce(p.author_id,p.user_id)
where pr.id is null;
" | grep -qx '0' || { echo "Broken post->profile references"; exit 2; }

sql "$TARGET_DB_URL" "
select count(*) from public.replies r
left join public.posts p on p.id=r.post_id
where p.id is null;
" | grep -qx '0' || { echo "Broken reply->post references"; exit 2; }

sql "$TARGET_DB_URL" "
select count(*) from public.posts q
left join public.posts origin on origin.id=q.quoted_post_id
where q.quoted_post_id is not null and origin.id is null;
" | grep -qx '0' || { echo "Broken quote->origin references"; exit 2; }

sql "$TARGET_DB_URL" "
select count(*) from public.reposts r
left join public.posts p on p.id=r.post_id
where p.id is null;
" | grep -qx '0' || { echo "Broken repost->post references"; exit 2; }

sql "$TARGET_DB_URL" "
select count(*) from public.post_reactions r
left join public.posts p on p.id=r.post_id
where p.id is null;
" | grep -qx '0' || { echo "Broken reaction->post references"; exit 2; }

sql "$TARGET_DB_URL" "
select count(*) from public.bookmarks b
left join public.posts p on p.id=b.post_id
where p.id is null;
" | grep -qx '0' || { echo "Broken bookmark->post references"; exit 2; }

echo "DATABASE VERIFICATION PASSED"
