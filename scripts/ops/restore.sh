#!/usr/bin/env bash
# Restores an encrypted backup made by backup.sh into a database (docs/ops/restore.md).
# Restore into a NEW database first and check it; never over production without a reason.
#
#   scripts/ops/restore.sh <backup-file> <age-identity-file> <target-mongodb-uri> [--nsFrom=db.* --nsTo=newdb.*]
set -euo pipefail

backup="${1:?usage: restore.sh <backup-file> <age-identity-file> <target-uri> [mongorestore options]}"
identity="${2:?missing the age identity (private key) file}"
target="${3:?missing the target MongoDB URI}"
shift 3

age --decrypt --identity "$identity" "$backup" \
  | mongorestore --uri="$target" --archive --gzip --quiet "$@"
echo "Restored $backup"
