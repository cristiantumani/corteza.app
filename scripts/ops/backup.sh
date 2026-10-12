#!/usr/bin/env bash
# Nightly backup (docs/specs/2026-10-ops-monitoring.md, restore: docs/ops/restore.md).
# Dumps the database with mongodump and encrypts the archive with age to a public key whose
# private key only the founder keeps offline. Nothing unencrypted is written to disk.
#
#   scripts/ops/backup.sh <out-file>
#   env: BACKUP_MONGODB_URI (read-only user), BACKUP_AGE_RECIPIENT (age1… public key)
set -euo pipefail

out="${1:?usage: backup.sh <out-file>}"
: "${BACKUP_MONGODB_URI:?BACKUP_MONGODB_URI is not set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"

mongodump --uri="$BACKUP_MONGODB_URI" --archive --gzip --quiet \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$out"

size=$(wc -c < "$out")
if [ "$size" -lt 1024 ]; then
  echo "Backup looks empty (${size} bytes)" >&2
  exit 1
fi
echo "Backup written: $out (${size} bytes, encrypted)"
