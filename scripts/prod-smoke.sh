#!/usr/bin/env bash
# BuhClaude — production smoke test.
#
# Read-only checks against a running stack (docker compose prod, k8s, bare VM).
# Does NOT create business data, does NOT need DB credentials — only the URLs.
#
# Usage:
#   ./scripts/prod-smoke.sh                              # localhost defaults
#   FRONTEND_URL=https://buh.example.ru ./scripts/prod-smoke.sh
#   FRONTEND_URL=http://localhost:8080 BACKEND_URL=http://localhost:8080 ./scripts/prod-smoke.sh
#
# Defaults assume `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`
# with FRONTEND_PORT=8080 and nginx reverse-proxying /api to backend.
#
# Exit 0 on success, 1 on any failure. Each check prints a one-line result.

set -uo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:8080}"
BACKEND_URL="${BACKEND_URL:-$FRONTEND_URL}"

fail=0

step() { printf "%-44s " "$1"; }
ok()   { printf "OK   %s\n" "${1:-}"; }
err()  { printf "FAIL %s\n" "$1"; fail=1; }

# 1. Frontend root — index.html shell.
step "1. GET ${FRONTEND_URL}/"
out="$(curl -fsS -o /tmp/prod-smoke.html -w '%{http_code} %{content_type}' "${FRONTEND_URL}/" 2>/dev/null || true)"
code="${out%% *}"
ctype="${out#* }"
if [[ "$code" == "200" && "$ctype" == text/html* ]]; then
  if grep -qi "<div id=\"root\"" /tmp/prod-smoke.html; then
    ok "200 html, SPA shell present"
  else
    err "200 but SPA shell (#root) not found"
  fi
else
  err "expected 200 + text/html, got '$code' '$ctype'"
fi

# 2. SPA fallback — deep route must still return index.html (200), not 404.
step "2. GET ${FRONTEND_URL}/login (SPA fallback)"
code="$(curl -fsS -o /tmp/prod-smoke-login.html -w '%{http_code}' "${FRONTEND_URL}/login" 2>/dev/null || true)"
if [[ "$code" == "200" ]] && grep -qi "<div id=\"root\"" /tmp/prod-smoke-login.html; then
  ok "200 SPA fallback"
else
  err "deep route should serve index.html (200), got '$code'"
fi

# 3. /api/v1/health — public, no auth.
step "3. GET ${BACKEND_URL}/api/v1/health"
body="$(curl -fsS "${BACKEND_URL}/api/v1/health" 2>/dev/null || true)"
if echo "$body" | grep -q '"status":"ok"'; then
  ok "status=ok"
else
  err "no status=ok in body: $(echo "$body" | head -c 200)"
fi

# 4. /api/v1/ready — must report database + uploads OK.
step "4. GET ${BACKEND_URL}/api/v1/ready"
body="$(curl -fsS "${BACKEND_URL}/api/v1/ready" 2>/dev/null || true)"
if echo "$body" | grep -q '"database":"ok"' && echo "$body" | grep -q '"uploads":"ok"'; then
  ok "database=ok, uploads=ok"
else
  err "ready not green: $(echo "$body" | head -c 200)"
fi

# 5. /api/v1/auth/me unauthenticated → must be 401, must NOT leak stack/secret.
step "5. GET ${BACKEND_URL}/api/v1/auth/me (unauth)"
out="$(curl -sS -o /tmp/prod-smoke-401.json -w '%{http_code}' "${BACKEND_URL}/api/v1/auth/me" 2>/dev/null || true)"
body="$(cat /tmp/prod-smoke-401.json 2>/dev/null || true)"
if [[ "$out" == "401" ]] \
   && ! echo "$body" | grep -qi "at /app\|stack\|Error:\|Trace\|node_modules\|JWT_SECRET\|password"; then
  ok "401, no stack/secret in body"
else
  err "expected 401 without stack/secret, got '$out' body: $(echo "$body" | head -c 200)"
fi

# 6. Static asset reachable. Pick the first hashed JS bundle from the SPA shell.
step "6. static asset reachable"
asset="$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' /tmp/prod-smoke.html | head -1 || true)"
if [[ -z "$asset" ]]; then
  err "no /assets/*.js reference found in index.html"
else
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "${FRONTEND_URL}${asset}" 2>/dev/null || true)"
  if [[ "$code" == "200" ]]; then
    ok "200 ${asset}"
  else
    err "expected 200 for ${asset}, got '$code'"
  fi
fi

rm -f /tmp/prod-smoke.html /tmp/prod-smoke-login.html /tmp/prod-smoke-401.json

echo
if (( fail == 0 )); then
  echo "All checks passed."
  exit 0
else
  echo "Smoke failed — see lines marked FAIL above."
  exit 1
fi
