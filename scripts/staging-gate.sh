#!/usr/bin/env bash

set -u

API_BASE="${API_BASE:-http://localhost:4000}"
TMP_DIR="${TMP_DIR:-/tmp/saiisai_staging_gate}"
SESSION_ID="${SESSION_ID:-staging-gate-$(date +%s)}"
WAIT_FOR_API_SECONDS="${WAIT_FOR_API_SECONDS:-0}"
WAIT_POLL_INTERVAL_SECONDS="${WAIT_POLL_INTERVAL_SECONDS:-2}"

mkdir -p "$TMP_DIR"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
LAST_REQUEST_FAILED=0

print_info() {
  printf '[INFO] %s\n' "$1"
}

print_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '[PASS] %s\n' "$1"
}

print_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[FAIL] %s\n' "$1"
}

print_warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '[WARN] %s\n' "$1"
}

extract_status_code() {
  awk 'toupper($0) ~ /^HTTP\// { code=$2 } END { print code }' "$1"
}

header_exists() {
  local headers_file="$1"
  local header_name="$2"
  awk -v h="$header_name" '
    BEGIN { found=0; low=tolower(h) ":" }
    {
      line=tolower($0)
      if (index(line, low) == 1) {
        found=1
      }
    }
    END { exit found ? 0 : 1 }
  ' "$headers_file"
}

request() {
  local name="$1"
  local method="$2"
  local url="$3"
  local data="${4:-}"
  local headers_file="$TMP_DIR/${name}.headers.txt"
  local body_file="$TMP_DIR/${name}.body.json"
  LAST_REQUEST_FAILED=0

  # Prevent stale content from previous runs causing false positives.
  : > "$headers_file"
  : > "$body_file"

  if [ -n "$data" ]; then
    curl -sS -X "$method" \
      -H 'Content-Type: application/json' \
      -D "$headers_file" \
      "$url" \
      --data "$data" \
      -o "$body_file" || LAST_REQUEST_FAILED=1
  else
    curl -sS -X "$method" \
      -D "$headers_file" \
      "$url" \
      -o "$body_file" || LAST_REQUEST_FAILED=1
  fi

  printf '%s\n' "$headers_file|$body_file"
}

ensure_connectivity() {
  print_info "Checking API reachability: $API_BASE"
  local elapsed=0

  while :; do
    local out
    out="$(request preflight GET "$API_BASE/health")"
    local headers_file="${out%%|*}"
    local status
    status="$(extract_status_code "$headers_file")"

    if [ "$LAST_REQUEST_FAILED" -eq 0 ] && [ -n "$status" ]; then
      print_pass "API is reachable ($status)"
      return 0
    fi

    if [ "$elapsed" -ge "$WAIT_FOR_API_SECONDS" ]; then
      print_fail "API is unreachable at $API_BASE. Start backend or set API_BASE correctly."
      return 1
    fi

    print_info "API not reachable yet; waiting ${WAIT_POLL_INTERVAL_SECONDS}s..."
    sleep "$WAIT_POLL_INTERVAL_SECONDS"
    elapsed=$((elapsed + WAIT_POLL_INTERVAL_SECONDS))
  done
}

run_health_check() {
  print_info "Running health check"
  local out
  out="$(request health GET "$API_BASE/health")"
  local headers_file="${out%%|*}"
  local body_file="${out##*|}"
  local status
  status="$(extract_status_code "$headers_file")"

  if [ "$LAST_REQUEST_FAILED" -eq 1 ]; then
    print_fail "Health check request failed (connection error)"
    return
  fi

  if [ "$status" = "200" ]; then
    print_pass "Health endpoint returns 200"
  else
    print_fail "Health endpoint returned $status (expected 200)"
  fi

  if awk 'BEGIN{ok=0} /"status"[[:space:]]*:[[:space:]]*"healthy"/ {ok=1} END{exit ok?0:1}' "$body_file"; then
    print_pass "Health body indicates healthy"
  else
    print_warn "Health body does not include status=healthy"
  fi
}

run_security_headers_check() {
  print_info "Checking security headers on /health"
  local headers_file="$TMP_DIR/health.headers.txt"

  if header_exists "$headers_file" 'content-security-policy'; then
    print_pass "CSP header present"
  else
    print_fail "CSP header missing"
  fi

  if header_exists "$headers_file" 'x-frame-options'; then
    print_pass "X-Frame-Options header present"
  else
    print_fail "X-Frame-Options header missing"
  fi

  if header_exists "$headers_file" 'x-content-type-options'; then
    print_pass "X-Content-Type-Options header present"
  else
    print_fail "X-Content-Type-Options header missing"
  fi

  if header_exists "$headers_file" 'strict-transport-security'; then
    print_pass "HSTS header present"
  else
    print_warn "HSTS header missing (often expected on HTTPS edge, not local HTTP)"
  fi
}

run_csrf_check() {
  print_info "Validating CSRF token endpoint"
  local out
  out="$(request csrf GET "$API_BASE/api/v1/csrf-token")"
  local headers_file="${out%%|*}"
  local body_file="${out##*|}"
  local status
  status="$(extract_status_code "$headers_file")"

  if [ "$LAST_REQUEST_FAILED" -eq 1 ]; then
    print_fail "CSRF token request failed (connection error)"
    return
  fi

  if [ "$status" = "200" ]; then
    print_pass "CSRF token endpoint returns 200"
  else
    print_fail "CSRF token endpoint returned $status"
  fi

  if header_exists "$headers_file" 'set-cookie'; then
    print_pass "CSRF endpoint sets cookie"
  else
    print_warn "CSRF endpoint did not set cookie"
  fi

  if awk 'BEGIN{ok=0} /"csrfToken"/ {ok=1} END{exit ok?0:1}' "$body_file"; then
    print_pass "CSRF response includes csrfToken"
  else
    print_fail "CSRF response missing csrfToken"
  fi
}

run_protected_route_check() {
  print_info "Checking protected route rejects unauthenticated user"
  local out
  out="$(request protected GET "$API_BASE/api/v1/logs/stats/homepage-experiments")"
  local headers_file="${out%%|*}"
  local status
  status="$(extract_status_code "$headers_file")"

  if [ "$LAST_REQUEST_FAILED" -eq 1 ]; then
    print_fail "Protected route request failed (connection error)"
    return
  fi

  if [ "$status" = "401" ] || [ "$status" = "403" ]; then
    print_pass "Protected route blocks unauthenticated access ($status)"
  else
    print_fail "Protected route returned $status (expected 401/403)"
  fi
}

run_analytics_limiter_probe() {
  print_info "Probing analytics ingestion limiter"
  local limit_hit=0
  local i=1
  local max_attempts=150
  local url="$API_BASE/api/v1/analytics/views"

  while [ "$i" -le "$max_attempts" ]; do
    local out
    out="$(request "analytics_$i" POST "$url" "{\"productId\":\"507f191e810c19729de860ea\",\"sessionId\":\"$SESSION_ID-$i\"}")"
    local headers_file="${out%%|*}"
    local status
    status="$(extract_status_code "$headers_file")"

    if [ "$LAST_REQUEST_FAILED" -eq 1 ]; then
      print_fail "Analytics limiter probe request failed (connection error)"
      return
    fi

    if [ "$status" = "429" ]; then
      limit_hit=1
      break
    fi

    i=$((i + 1))
  done

  if [ "$limit_hit" -eq 1 ]; then
    print_pass "Analytics limiter returned 429 within $max_attempts attempts"
  else
    print_warn "Analytics limiter not hit in $max_attempts attempts (could be expected in non-prod config)"
  fi
}

run_tracking_limiter_probe() {
  print_info "Probing public tracking limiter"
  local limit_hit=0
  local i=1
  local max_attempts=120
  local url="$API_BASE/api/v1/order/track/STAGING-NOT-REAL-TRACKING"

  while [ "$i" -le "$max_attempts" ]; do
    local out
    out="$(request "tracking_$i" GET "$url")"
    local headers_file="${out%%|*}"
    local status
    status="$(extract_status_code "$headers_file")"

    if [ "$LAST_REQUEST_FAILED" -eq 1 ]; then
      print_fail "Tracking limiter probe request failed (connection error)"
      return
    fi

    if [ "$status" = "429" ]; then
      limit_hit=1
      break
    fi

    i=$((i + 1))
  done

  if [ "$limit_hit" -eq 1 ]; then
    print_pass "Tracking limiter returned 429 within $max_attempts attempts"
  else
    print_warn "Tracking limiter not hit in $max_attempts attempts (could be expected in non-prod config)"
  fi
}

run_search_sanitization_smoke() {
  print_info "Running search sanitization smoke tests"
  local bad_query='%3Cscript%3Ealert(1)%3C%2Fscript%3E'
  local out
  out="$(request search_query GET "$API_BASE/api/v1/search/query/$bad_query")"
  local headers_file="${out%%|*}"
  local status
  status="$(extract_status_code "$headers_file")"

  if [ "$LAST_REQUEST_FAILED" -eq 1 ]; then
    print_fail "Search query sanitization request failed (connection error)"
    return
  fi

  case "$status" in
    200|400|422)
      print_pass "Search query endpoint handled suspicious payload safely ($status)"
      ;;
    *)
      print_fail "Search query endpoint returned unexpected status $status"
      ;;
  esac

  out="$(request search_suggestions GET "$API_BASE/api/v1/search/suggestions/$bad_query")"
  headers_file="${out%%|*}"
  status="$(extract_status_code "$headers_file")"

  if [ "$LAST_REQUEST_FAILED" -eq 1 ]; then
    print_fail "Search suggestions sanitization request failed (connection error)"
    return
  fi

  case "$status" in
    200|400|422)
      print_pass "Search suggestions endpoint handled suspicious payload safely ($status)"
      ;;
    *)
      print_fail "Search suggestions endpoint returned unexpected status $status"
      ;;
  esac
}

print_summary() {
  printf '\n'
  printf '==============================\n'
  printf 'Saiisai Staging Gate Summary\n'
  printf '==============================\n'
  printf 'API_BASE: %s\n' "$API_BASE"
  printf 'PASS: %s\n' "$PASS_COUNT"
  printf 'FAIL: %s\n' "$FAIL_COUNT"
  printf 'WARN: %s\n' "$WARN_COUNT"
  printf 'Artifacts: %s\n' "$TMP_DIR"
  printf '==============================\n'

  if [ "$FAIL_COUNT" -gt 0 ]; then
    printf 'FINAL: NO-GO (one or more failed checks)\n'
    return 1
  fi

  printf 'FINAL: CONDITIONAL GO (no fails; review warnings)\n'
  return 0
}

main() {
  print_info "Starting staging gate checks against $API_BASE"
  if ! ensure_connectivity; then
    print_summary
    return 1
  fi
  run_health_check
  run_security_headers_check
  run_csrf_check
  run_protected_route_check
  run_analytics_limiter_probe
  run_tracking_limiter_probe
  run_search_sanitization_smoke
  print_summary
}

main "$@"
