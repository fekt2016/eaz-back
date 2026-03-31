#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-https://api.saiisai.com}"
AUTH_WARN_SECONDS="${AUTH_WARN_SECONDS:-3.0}"
AUTH_FAIL_SECONDS="${AUTH_FAIL_SECONDS:-6.0}"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

print_header() {
  echo "==============================================="
  echo "Auth Latency Check"
  echo "API_BASE: ${API_BASE}"
  echo "WARN if > ${AUTH_WARN_SECONDS}s, FAIL if > ${AUTH_FAIL_SECONDS}s"
  echo "==============================================="
}

measure_request() {
  local label="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"

  local output=""
  if [ -n "$body" ]; then
    output="$(curl -sS -o /dev/null \
      -X "$method" \
      -H "Content-Type: application/json" \
      -d "$body" \
      -w "status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}" \
      "$url")"
  else
    output="$(curl -sS -o /dev/null \
      -X "$method" \
      -w "status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}" \
      "$url")"
  fi

  local status
  local ttfb
  local total
  status="$(printf "%s\n" "$output" | awk '{for (i=1;i<=NF;i++) if ($i ~ /^status=/) {split($i,a,"="); print a[2]}}')"
  ttfb="$(printf "%s\n" "$output" | awk '{for (i=1;i<=NF;i++) if ($i ~ /^ttfb=/) {split($i,a,"="); print a[2]}}')"
  total="$(printf "%s\n" "$output" | awk '{for (i=1;i<=NF;i++) if ($i ~ /^total=/) {split($i,a,"="); print a[2]}}')"

  printf "%-14s status=%-3s ttfb=%-8ss total=%ss\n" "$label" "$status" "$ttfb" "$total"

  if awk "BEGIN {exit !($ttfb > $AUTH_FAIL_SECONDS)}"; then
    echo "  -> FAIL: TTFB exceeds ${AUTH_FAIL_SECONDS}s"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  elif awk "BEGIN {exit !($ttfb > $AUTH_WARN_SECONDS)}"; then
    echo "  -> WARN: TTFB exceeds ${AUTH_WARN_SECONDS}s"
    WARN_COUNT=$((WARN_COUNT + 1))
  else
    echo "  -> PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
}

main() {
  print_header

  measure_request "health" "GET" "${API_BASE}/health"
  measure_request "seller/me" "GET" "${API_BASE}/api/v1/seller/me"
  measure_request "seller/login" "POST" "${API_BASE}/api/v1/seller/login" \
    '{"email":"probe@example.com","password":"badpass"}'
  measure_request "seller/signup" "POST" "${API_BASE}/api/v1/seller/signup" \
    '{"email":"probe@example.com","password":"badpass","shopName":"Probe Shop"}'

  echo "-----------------------------------------------"
  echo "PASS=${PASS_COUNT} WARN=${WARN_COUNT} FAIL=${FAIL_COUNT}"

  if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "FINAL: FAIL"
    exit 1
  fi

  if [ "$WARN_COUNT" -gt 0 ]; then
    echo "FINAL: WARN"
    exit 0
  fi

  echo "FINAL: PASS"
}

main "$@"
