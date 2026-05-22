# BuhClaude - production smoke test (PowerShell 5.1 / pwsh 7).
#
# Read-only checks against a running stack. Does NOT create business data,
# does NOT need DB credentials - only the URLs.
#
# Usage:
#   powershell -File scripts/prod-smoke.ps1
#   powershell -File scripts/prod-smoke.ps1 -FrontendUrl https://buh.example.ru
#   powershell -File scripts/prod-smoke.ps1 -FrontendUrl http://localhost:8080 -BackendUrl http://localhost:8080
#
# Exits 0 on success, 1 on any failure.

[CmdletBinding()]
param(
  [string]$FrontendUrl = $(if ($env:FRONTEND_URL) { $env:FRONTEND_URL } else { "http://localhost:8080" }),
  [string]$BackendUrl  = $(if ($env:BACKEND_URL)  { $env:BACKEND_URL  } else { $null })
)

if (-not $BackendUrl) { $BackendUrl = $FrontendUrl }

$ErrorActionPreference = "Continue"
$fail = 0
$shell = $null   # cached index.html for asset discovery in step 6

function Step([string]$label) {
  $padded = $label.PadRight(44, ' ')
  Write-Host -NoNewline $padded
}
function Ok([string]$msg) {
  Write-Host "OK   $msg" -ForegroundColor Green
}
function Fail([string]$msg) {
  Write-Host "FAIL $msg" -ForegroundColor Red
  $script:fail = 1
}

# --- 1. Frontend root: SPA shell ----------------------------------------------
Step "1. GET $FrontendUrl/"
try {
  $r = Invoke-WebRequest -Uri "$FrontendUrl/" -UseBasicParsing -TimeoutSec 10
  if ($r.StatusCode -eq 200 -and $r.Headers["Content-Type"] -match "text/html" -and $r.Content -match '<div id="root"') {
    $shell = $r.Content
    Ok "200 html, SPA shell present"
  } else {
    Fail "unexpected status/type/body: $($r.StatusCode) $($r.Headers['Content-Type'])"
  }
} catch {
  Fail "request failed: $($_.Exception.Message)"
}

# --- 2. SPA deep route fallback ------------------------------------------------
Step "2. GET $FrontendUrl/login (SPA fallback)"
try {
  $r = Invoke-WebRequest -Uri "$FrontendUrl/login" -UseBasicParsing -TimeoutSec 10
  if ($r.StatusCode -eq 200 -and $r.Content -match '<div id="root"') {
    Ok "200 SPA fallback"
  } else {
    Fail "deep route should serve index.html (200), got $($r.StatusCode)"
  }
} catch {
  Fail "request failed: $($_.Exception.Message)"
}

# --- 3. /api/v1/health ---------------------------------------------------------
Step "3. GET $BackendUrl/api/v1/health"
try {
  $j = Invoke-RestMethod -Uri "$BackendUrl/api/v1/health" -TimeoutSec 10
  if ($j.status -eq "ok") { Ok "status=ok" } else { Fail "no status=ok in body: $($j | ConvertTo-Json -Compress)" }
} catch {
  Fail "request failed: $($_.Exception.Message)"
}

# --- 4. /api/v1/ready ----------------------------------------------------------
Step "4. GET $BackendUrl/api/v1/ready"
try {
  $j = Invoke-RestMethod -Uri "$BackendUrl/api/v1/ready" -TimeoutSec 10
  if ($j.checks.database -eq "ok" -and $j.checks.uploads -eq "ok") {
    Ok "database=ok, uploads=ok"
  } else {
    Fail "ready not green: $($j | ConvertTo-Json -Compress)"
  }
} catch {
  Fail "request failed: $($_.Exception.Message)"
}

# --- 5. /api/v1/auth/me unauth -> 401, no stack/secret -------------------------
Step "5. GET $BackendUrl/api/v1/auth/me (unauth)"
try {
  $r = Invoke-WebRequest -Uri "$BackendUrl/api/v1/auth/me" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  Fail "expected 401, got $($r.StatusCode)"
} catch {
  $resp = $_.Exception.Response
  if ($resp -and $resp.StatusCode.value__ -eq 401) {
    $body = ""
    try {
      $stream = $resp.GetResponseStream()
      $sr = New-Object System.IO.StreamReader($stream)
      $body = $sr.ReadToEnd()
    } catch {}
    if ($body -match "at /app|stack|Error:|node_modules|JWT_SECRET|password") {
      Fail "401 leaks stack/secret: $($body.Substring(0, [Math]::Min(200, $body.Length)))"
    } else {
      Ok "401, no stack/secret in body"
    }
  } else {
    Fail "expected 401, request failed: $($_.Exception.Message)"
  }
}

# --- 6. First hashed asset from the SPA shell is reachable ---------------------
Step "6. static asset reachable"
if (-not $shell) {
  Fail "step 1 failed - no SPA shell to extract asset path from"
} else {
  $m = [regex]::Match($shell, '/assets/[A-Za-z0-9._-]+\.js')
  if (-not $m.Success) {
    Fail "no /assets/*.js reference found in index.html"
  } else {
    $asset = $m.Value
    try {
      $r = Invoke-WebRequest -Uri "$FrontendUrl$asset" -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200) { Ok "200 $asset" } else { Fail "expected 200, got $($r.StatusCode)" }
    } catch {
      Fail "request failed: $($_.Exception.Message)"
    }
  }
}

Write-Host ""
if ($fail -eq 0) {
  Write-Host "All checks passed." -ForegroundColor Green
  exit 0
} else {
  Write-Host "Smoke failed - see lines marked FAIL above." -ForegroundColor Red
  exit 1
}
