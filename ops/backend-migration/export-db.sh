#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL to the source Postgres connection string}"
OUT="${1:-backend-migration-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"

command -v pg_dump >/dev/null || { echo "pg_dump is required"; exit 1; }
command -v psql >/dev/null || { echo "psql is required"; exit 1; }

echo "Writing source manifest..."
psql "$SOURCE_DB_URL" -v ON_ERROR_STOP=1 -Atc "select public.backend_portability_manifest()" > "$OUT/manifest.json"

echo "Exporting roles..."
pg_dump "$SOURCE_DB_URL" --no-owner --no-privileges --role-only > "$OUT/roles.sql"

echo "Exporting public schema..."
pg_dump "$SOURCE_DB_URL" --no-owner --no-privileges --schema=public --schema-only > "$OUT/public-schema.sql"

echo "Exporting public data..."
pg_dump "$SOURCE_DB_URL" --no-owner --no-privileges --schema=public --data-only --inserts > "$OUT/public-data.sql"

echo "Exporting auth/storage managed schemas separately..."
pg_dump "$SOURCE_DB_URL" --no-owner --no-privileges --schema=auth --schema=storage --schema-only > "$OUT/managed-schema.sql"
pg_dump "$SOURCE_DB_URL" --no-owner --no-privileges --schema=auth --schema=storage --data-only --inserts > "$OUT/managed-data.sql"

cat > "$OUT/README.txt" <<'EOF'
SOURCE EXPORT
Database schema/data and managed auth/storage metadata are included.
Storage object BYTES are NOT contained in these SQL files.
Export object bytes separately and keep bucket/object paths unchanged.
Do not delete the source after this export.
EOF

echo "Export complete: $OUT"
