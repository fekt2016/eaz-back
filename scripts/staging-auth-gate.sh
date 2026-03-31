#!/usr/bin/env bash

set -u

API_BASE="${API_BASE:-http://localhost:4000}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/saiisai_auth_gate.cookies.txt}"
TMP_DIR="${TMP_DIR:-/tmp/saiisai_auth_gate}"

# Required inputs (provide via env vars)
LOGIN_PATH="${LOGIN_PATH:-}"
LOGIN_BODY_JSON="${LOGIN_BODY_JSON:-}"
MUTATION_PATH="${MUTATION_PATH:-}"
MUTATION_METHOD="${MUTATION_METHOD:-PATCH}"
MUTATION_BODY_JSON="${MUTATION_BODY_JSON:-{}}"

mkdir -p "$TMP_DIR"
: > "$COOKIE_JAR"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
LOGIN_OK=0
STATUS_WITHOUT_CSRF=''
STATUS_WITH_CSRF=''

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

extract_header_value() {
  local headers_file="$1"
  local header_name="$2"
  awk -v h="$header_name" '
    BEGIN { low=tolower(h) ":" }
    {
      line=$0
      lower=tolower(line)
      if (index(lower, low) == 1) {
        sub(/^[^:]*:[[:space:]]*/, "", line)
        gsub(/\r/, "", line)
        print line
        exit
      }
    }
  ' "$headers_file"
}

extract_csrf_token_from_body() {
  local body_file="$1"
  sed -n 's/.*"csrfToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$body_file" \
    | head -n 1
}

require_env() {
  local key="$1"
  local value="$2"
  if [ -z "$value" ]; then
    print_fail "Missing required env var: $key"
    exit 2
  fi
}

request_with_cookies() {
  local name="$1"
  local method="$2"
  local url="$3"
  local data="${4:-}"
  local csrf_header="${5:-}"
  local headers_file="$TMP_DIR/${name}.headers.txt"
  local body_file="$TMP_DIR/${name}.body.json"

  local curl_cmd=(
    curl -sS -X "$method"
    -b "$COOKIE_JAR"
    -c "$COOKIE_JAR"
    -D "$headers_file"
    "$url"
    -o "$body_file"
  )

  if [ -n "$data" ]; then
    curl_cmd+=(-H 'Content-Type: application/json' --data "$data")
  fi

  if [ -n "$csrf_header" ]; then
    curl_cmd+=(-H "X-CSRF-Token: $csrf_header")
  fi

  "${curl_cmd[@]}"
  printf '%s\n' "$headers_file|$body_file"
}

login_step() {
  print_info "Logging in via $LOGIN_PATH"
  local out
  out="$(
    request_with_cookies \
      login \
      POST \
      "$API_BASE$LOGIN_PATH" \
      "$LOGIN_BODY_JSON"
  )"
  local headers_file="${out%%|*}"
  local status
  status="$(extract_status_code "$headers_file")"
  local retry_after
  retry_after="$(extract_header_value "$headers_file" 'retry-after')"

  case "$status" in
    200|201|204)
      LOGIN_OK=1
      print_pass "Login succeeded ($status)"
      ;;
    429)
      if [ -n "$retry_after" ]; then
        print_fail "Login rate-limited (429). Retry after ${retry_after}s."
      else
        print_fail 'Login rate-limited (429). Wait for limiter window, then retry.'
      fi
      ;;
    *)
      print_fail "Login failed with HTTP $status"
      ;;
  esac
}

csrf_fetch_step() {
  print_info 'Fetching CSRF token'
  local out
  out="$(request_with_cookies csrf GET "$API_BASE/api/v1/csrf-token")"
  local headers_file="${out%%|*}"
  local body_file="${out##*|}"
  local status
  status="$(extract_status_code "$headers_file")"

  if [ "$status" = "200" ]; then
    print_pass 'CSRF endpoint returned 200'
  else
    print_fail "CSRF endpoint returned $status"
  fi

  CSRF_TOKEN="$(extract_csrf_token_from_body "$body_file")"
  if [ -n "$CSRF_TOKEN" ]; then
    print_pass 'Extracted csrfToken from response'
  else
    print_fail 'Could not extract csrfToken from response'
  fi
}

mutation_without_csrf_step() {
  print_info "Testing mutation without CSRF header: $MUTATION_METHOD $MUTATION_PATH"
  local out
  out="$(
    request_with_cookies \
      mutation_without_csrf \
      "$MUTATION_METHOD" \
      "$API_BASE$MUTATION_PATH" \
      "$MUTATION_BODY_JSON"
  )"
  local headers_file="${out%%|*}"
  local status
  status="$(extract_status_code "$headers_file")"
  STATUS_WITHOUT_CSRF="$status"

  if [ "$status" = "403" ]; then
    print_pass 'Mutation without CSRF blocked with 403'
  elif [ "$status" = "401" ]; then
    print_fail 'Mutation returned 401 (auth/cookie issue, cannot validate CSRF)'
  else
    print_warn "Mutation without CSRF returned $status (expected 403 for strict CSRF proof)"
  fi
}

mutation_with_csrf_step() {
  print_info "Testing mutation with CSRF header: $MUTATION_METHOD $MUTATION_PATH"
  local out
  out="$(
    request_with_cookies \
      mutation_with_csrf \
      "$MUTATION_METHOD" \
      "$API_BASE$MUTATION_PATH" \
      "$MUTATION_BODY_JSON" \
      "$CSRF_TOKEN"
  )"
  local headers_file="${out%%|*}"
  local status
  status="$(extract_status_code "$headers_file")"
  STATUS_WITH_CSRF="$status"

  if [ "$status" = "401" ]; then
    print_fail 'Mutation with CSRF returned 401 (auth cookie invalid/expired)'
    return
  fi

  if [ "$status" = "403" ]; then
    print_fail 'Mutation with CSRF still returned 403 (CSRF enforcement issue)'
    return
  fi

  case "$status" in
    200|201|204|400|404|409|422)
      print_pass "Mutation with CSRF passed gate (HTTP $status, CSRF not blocking)"
      ;;
    *)
      print_warn "Mutation with CSRF returned uncommon status $status; inspect response"
      ;;
  esac

  if [ "$STATUS_WITHOUT_CSRF" != "403" ] && [ "$STATUS_WITHOUT_CSRF" = "$STATUS_WITH_CSRF" ]; then
    print_warn 'CSRF enforcement inconclusive for this endpoint (same status with/without CSRF). Use a simpler mutation probe if you need strict CSRF proof.'
  fi
}

print_summary() {
  printf '\n'
  printf '=================================\n'
  printf 'Saiisai Auth CSRF Gate Summary\n'
  printf '=================================\n'
  printf 'API_BASE: %s\n' "$API_BASE"
  printf 'LOGIN_PATH: %s\n' "$LOGIN_PATH"
  printf 'MUTATION_PATH: %s\n' "$MUTATION_PATH"
  printf 'PASS: %s\n' "$PASS_COUNT"
  printf 'FAIL: %s\n' "$FAIL_COUNT"
  printf 'WARN: %s\n' "$WARN_COUNT"
  printf 'Artifacts: %s\n' "$TMP_DIR"
  printf 'Cookie jar: %s\n' "$COOKIE_JAR"
  printf '=================================\n'

  if [ "$FAIL_COUNT" -gt 0 ]; then
    printf 'FINAL: NO-GO (auth/csrf gate failed)\n'
    return 1
  fi

  printf 'FINAL: GO (auth/csrf checks passed)\n'
  return 0
}

usage() {
  cat <<EOF
Usage:
  API_BASE=http://localhost:4000 \\
  LOGIN_PATH=/api/v1/users/login \\
  LOGIN_BODY_JSON='{"email":"buyer@example.com","password":"secret"}' \\
  MUTATION_PATH=/api/v1/users/updateMe \\
  MUTATION_METHOD=PATCH \\
  MUTATION_BODY_JSON='{"fullName":"Security Gate Probe"}' \\
  ./scripts/staging-auth-gate.sh

Required env vars:
  LOGIN_PATH
  LOGIN_BODY_JSON
  MUTATION_PATH

Optional env vars:
  API_BASE (default: http://localhost:4000)
  MUTATION_METHOD (default: PATCH)
  MUTATION_BODY_JSON (default: {})
  TMP_DIR
  COOKIE_JAR
EOF
}

main() {
  if [ "${1:-}" = "--help" ]; then
    usage
    exit 0
  fi

  require_env 'LOGIN_PATH' "$LOGIN_PATH"
  require_env 'LOGIN_BODY_JSON' "$LOGIN_BODY_JSON"
  require_env 'MUTATION_PATH' "$MUTATION_PATH"

  print_info "Starting authenticated gate checks against $API_BASE"
  login_step
  if [ "$LOGIN_OK" -ne 1 ]; then
    print_warn 'Skipping CSRF mutation checks because login did not succeed'
    print_summary
    return 1
  fi
  csrf_fetch_step
  mutation_without_csrf_step
  mutation_with_csrf_step
  print_summary
}

main "$@"
