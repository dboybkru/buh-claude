#!/usr/bin/env bash
# BuhClaude — backup PostgreSQL через docker exec + pg_dump
# Использование:
#   ./scripts/backup-db.sh
#   DB=buhclaude_test ./scripts/backup-db.sh
#   OUT_DIR=/var/backups ./scripts/backup-db.sh
set -euo pipefail

CONTAINER="${CONTAINER:-buhclaude-postgres}"
USER="${PGUSER:-buhclaude}"
DB="${DB:-buhclaude}"
OUT_DIR="${OUT_DIR:-backups}"

mkdir -p "$OUT_DIR"
STAMP=$(date +%Y-%m-%d_%H-%M-%S)
FILE="$OUT_DIR/${DB}-${STAMP}.dump"

echo "→ Бэкап $DB из контейнера $CONTAINER в $FILE"
docker exec "$CONTAINER" pg_dump -U "$USER" -d "$DB" -Fc --no-owner --no-acl > "$FILE"

SIZE_KB=$(du -k "$FILE" | cut -f1)
echo "✓ Бэкап создан (${SIZE_KB} KB): $FILE"
