# BuhClaude — backup PostgreSQL через docker exec + pg_dump
# Использование:
#   pwsh scripts/backup-db.ps1                      # дамп в backups/buhclaude-YYYY-MM-DD_HH-mm-ss.dump
#   pwsh scripts/backup-db.ps1 -Database test       # другая БД
#   pwsh scripts/backup-db.ps1 -OutDir D:\bk        # другая папка
#
# Внимание: дамп содержит ВСЕ данные пользователей. Храните бэкапы вне репозитория.
# Папка backups/ исключена из git через .gitignore.

[CmdletBinding()]
param(
  [string]$Container = "buhclaude-postgres",
  [string]$User      = "buhclaude",
  [string]$Database  = "buhclaude",
  [string]$OutDir    = "backups"
)

$ErrorActionPreference = "Stop"

# Создаём папку, если её нет
if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$file  = Join-Path $OutDir "$Database-$stamp.dump"

Write-Host "→ Бэкап $Database из контейнера $Container в $file" -ForegroundColor Cyan

# pg_dump в формате custom (-Fc) — самый универсальный, восстанавливается через pg_restore.
# --no-owner / --no-acl делают дамп переносимым между экземплярами с разными ролями.
docker exec -t $Container pg_dump -U $User -d $Database -Fc --no-owner --no-acl | Out-File -FilePath $file -Encoding Byte
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump упал с кодом $LASTEXITCODE"
  exit 1
}

$size = (Get-Item $file).Length
Write-Host "✓ Бэкап создан ($('{0:N1}' -f ($size / 1KB)) KB): $file" -ForegroundColor Green
