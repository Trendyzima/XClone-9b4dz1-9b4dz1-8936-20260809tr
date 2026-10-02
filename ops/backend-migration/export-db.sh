#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL to the source Postgres connection string}"
OUT="${1:-backend-migration-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"

command -v supabase >/dev/null || { echo "Supabase CLI is required"; exit 1; }
command -v psql >/dev/null || { echo "psql is required"; exit 1; }

echo "Writing source manifest..."
psql "$SOURCE_DB_URL" -v ON_ERROR_STOP=1 -Atc "select public.backend_portability_manifest()" > "$OUT/manifest.json"

echo "Exporting database roles using Supabase CLI..."
supabase db dump --db-url "$SOURCE_DB_URL" -f "$OUT/roles.sql" --role-only

echo "Exporting database schema..."
supabase db dump --db-url "$SOURCE_DB_URL" -f "$OUT/schema.sql"

echo "Exporting database data..."
supabase db dump --db-url "$SOURCE_DB_URL" -f "$OUT/data.sql" --use-copy --data-only   -x "storage.buckets_vectors"   -x "storage.vector_indexes"

echo "Exporting migration history..."
supabase db dump --db-url "$SOURCE_DB_URL" -f "$OUT/history-schema.sql" --schema supabase_migrations --schema-only
supabase db dump --db-url "$SOURCE_DB_URL" -f "$OUT/history-data.sql" --schema supabase_migrations --use-copy --data-only

cat > "$OUT/README.txt" <<'EOF'
SOURCE EXPORT
This export contains the database roles, schema, data, and Supabase migration history.
Auth users are part of the database data export when the source dump includes the auth schema.
Storage object BYTES are NOT contained in the SQL dump; Storage metadata and bucket configuration
are database records, while the actual object bytes must be copied separately.

Migration invariants:
- UUID primary/foreign keys are preserved exactly.
- ActivityPub URIs and federation identifiers are preserved exactly.
- media_assets.bucket and media_assets.storage_key are preserved exactly.
- The source backend is never deleted or modified by this export.
- Restore into a separate target, verify counts and referential integrity, then cut over.
EOF

echo "Export complete: $OUT"
