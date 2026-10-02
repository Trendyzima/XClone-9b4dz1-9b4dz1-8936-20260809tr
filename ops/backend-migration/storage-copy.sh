#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_PROJECT_REF:?Set SOURCE_PROJECT_REF}"
: "${TARGET_PROJECT_REF:?Set TARGET_PROJECT_REF}"
: "${SOURCE_BUCKETS:?Set SOURCE_BUCKETS to a space-separated bucket list}"
: "${EXPORT_DIR:?Set EXPORT_DIR}"

command -v supabase >/dev/null || { echo "Supabase CLI is required"; exit 1; }
mkdir -p "$EXPORT_DIR"

echo "Storage migration is copy-only. Source objects are never removed."

for bucket in $SOURCE_BUCKETS; do
  mkdir -p "$EXPORT_DIR/$bucket"
  echo "Exporting bucket: $bucket"
  supabase storage cp "ss://$bucket" "$EXPORT_DIR/$bucket" -r --experimental
done

echo "Restore into TARGET_PROJECT_REF using the same bucket names and object paths."
echo "Example per bucket:"
echo "  supabase storage cp $EXPORT_DIR/<bucket> ss://<bucket> -r --experimental"
echo "Run the restore only after creating matching buckets on the target."
