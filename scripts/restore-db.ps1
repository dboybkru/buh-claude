# BuhClaude — restore PostgreSQL дампа в БД через docker exec + pg_restore
# Использование:
#   pwsh scripts/restore-db.ps1 -File backups/buhclaude-2026-05-22_12-00-00.dump
#   pwsh scripts/restore-db.ps1 -File ... -Database buhclaude_test
#
# ВНИМАНИЕ: restore через --clean удаляет существующие объекты в целевой БД.
# Перед запуском убедитесь, что вы знаете, куда восстанавливаете.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$File,
  [string]$Container = "buhclaude-postgres",
  [string]$User      = "buhclaude",
  [string]$Database  = "buhclaude"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $File)) {
  Write-Error "Файл бэкапа не найден: $File"
  exit 1
}

Write-Host "→ Восстановление $Database из $File в контейнер $Container" -ForegroundColor Cyan
Write-Host "  (--clean: существующие объекты будут удалены и пересозданы)" -ForegroundColor Yellow

# Передаём поток дампа в контейнерный pg_restore через docker exec -i
Get-Content -Path $File -Encoding Byte -Raw | docker exec -i $Container pg_restore -U $User -d $Database --clean --if-exists --no-owner --no-acl
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_restore завершился с кодом $LASTEXITCODE — проверьте лог выше"
  exit 1
}

Write-Host "✓ Восстановление завершено успешно." -ForegroundColor Green
