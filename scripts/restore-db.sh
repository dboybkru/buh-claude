#!/usr/bin/env bash
# BuhClaude — restore PostgreSQL дампа через docker exec + pg_restore
# Использование:
#   ./scripts/restore-db.sh backups/buhclaude-2026-05-22_12-00-00.dump
#   DB=buhclaude_test ./scripts/restore-db.sh path/to.dump
set -euo pipefail

CONTAINER="${CONTAINER:-buhclaude-postgres}"
USER="${PGUSER:-buhclaude}"
DB="${DB:-buhclaude}"

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  echo "Использование: $0 <backup-file.dump>" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "Файл бэкапа не найден: $FILE" >&2
  exit 1
fi

echo "→ Восстановление $DB из $FILE в контейнер $CONTAINER"
echo "  (--clean: существующие объекты будут удалены и пересозданы)"
cat "$FILE" | docker exec -i "$CONTAINER" pg_restore -U "$USER" -d "$DB" --clean --if-exists --no-owner --no-acl
echo "✓ Восстановление завершено успешно."
