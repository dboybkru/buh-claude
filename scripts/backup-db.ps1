# BuhClaude - backup PostgreSQL via docker exec + pg_dump (custom format)
#
# Usage:
#   powershell -File scripts/backup-db.ps1
#   powershell -File scripts/backup-db.ps1 -Database buhclaude_test
#   powershell -File scripts/backup-db.ps1 -OutDir D:\bk
#   pwsh -File scripts/backup-db.ps1                 # PowerShell 7+ also OK
#
# Output: backups/<db>-YYYY-MM-DD_HH-mm-ss.dump (pg_dump -Fc)
#
# IMPORTANT: dump may contain ALL user data. Store outside the repo.
# backups/ is excluded from git via .gitignore.

[CmdletBinding()]
param(
  [string]$Container = "buhclaude-postgres",
  [string]$DbUser    = "buhclaude",
  [string]$Database  = "buhclaude",
  [string]$OutDir    = "backups"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$stamp     = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$file      = Join-Path $OutDir "$Database-$stamp.dump"
$inDocker  = "/tmp/buhclaude-backup-$stamp.dump"

Write-Host "-> Backup $Database from container $Container to $file" -ForegroundColor Cyan

# pg_dump writes the custom-format binary dump to a file INSIDE the container.
# We then docker cp it out. This avoids the classic PowerShell trap of binary
# bytes being mangled by stdout encoding / Out-File when piping pg_dump output.
& docker exec $Container pg_dump -U $DbUser -d $Database -Fc --no-owner --no-acl -f $inDocker
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump failed (exit $LASTEXITCODE)"
  exit 1
}

& docker cp ("${Container}:${inDocker}") $file
if ($LASTEXITCODE -ne 0) {
  Write-Error "docker cp failed (exit $LASTEXITCODE)"
  exit 1
}

# Clean up the in-container temp file
& docker exec $Container rm -f $inDocker | Out-Null

$size = (Get-Item $file).Length
$kb   = [math]::Round($size / 1KB, 1)
Write-Host "OK Backup created ($kb KB): $file" -ForegroundColor Green
