# BuhClaude - restore PostgreSQL dump via docker cp + pg_restore
#
# Usage:
#   powershell -File scripts/restore-db.ps1 -File backups/buhclaude-2026-05-22_12-00-00.dump
#   powershell -File scripts/restore-db.ps1 -File ... -Database buhclaude_test
#   pwsh -File scripts/restore-db.ps1 -File ...       # PowerShell 7+ also OK
#
# WARNING: --clean removes existing public.* objects in the target database
# before restoring. Make sure -Database points at the right DB. For a safe
# dry-run, restore into buhclaude_test instead of the production DB.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$File,
  [string]$Container = "buhclaude-postgres",
  [string]$DbUser    = "buhclaude",
  [string]$Database  = "buhclaude"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $File)) {
  Write-Error "Dump file not found: $File"
  exit 1
}

$stamp    = Get-Date -Format "yyyyMMddHHmmss"
$inDocker = "/tmp/buhclaude-restore-$stamp.dump"

Write-Host "-> Restore $Database from $File into container $Container" -ForegroundColor Cyan
Write-Host "   (--clean: existing public.* objects will be dropped and recreated)" -ForegroundColor Yellow

# Copy dump INTO the container, then run pg_restore there. This avoids the
# binary-pipe problems with `Get-Content -Encoding Byte | docker exec -i ...`
# on Windows PowerShell.
& docker cp $File ("${Container}:${inDocker}")
if ($LASTEXITCODE -ne 0) {
  Write-Error "docker cp failed (exit $LASTEXITCODE)"
  exit 1
}

& docker exec $Container pg_restore -U $DbUser -d $Database --clean --if-exists --no-owner --no-acl $inDocker
$restoreExit = $LASTEXITCODE

& docker exec $Container rm -f $inDocker | Out-Null

if ($restoreExit -ne 0) {
  Write-Error "pg_restore exited with code $restoreExit - see output above"
  exit 1
}

Write-Host "OK Restore completed." -ForegroundColor Green
