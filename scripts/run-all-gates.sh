#!/usr/bin/env bash

set -u

API_BASE="${API_BASE:-http://localhost:4000}"
REPORT_DIR="${REPORT_DIR:-/tmp/saiisai_gate_reports}"
AUTH_GATE_SLEEP_SECONDS="${AUTH_GATE_SLEEP_SECONDS:-2}"
mkdir -p "$REPORT_DIR"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

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

run_and_capture() {
  local name="$1"
  shift
  local log_file="$REPORT_DIR/${name}.log"

  print_info "Running $name"
  if "$@" >"$log_file" 2>&1; then
    print_pass "$name completed"
    return 0
  fi

  print_fail "$name failed (see $log_file)"
  return 1
}

run_smoke_gate() {
  local tmp_dir="$REPORT_DIR/smoke-artifacts"
  run_and_capture \
    smoke_gate \
    env API_BASE="$API_BASE" TMP_DIR="$tmp_dir" ./scripts/staging-gate.sh
}

run_auth_gate_for_role() {
  local role="$1"
  local login_path="$2"
  local login_body="$3"
  local mutation_path="$4"
  local mutation_method="$5"
  local mutation_body="$6"

  if [ -z "$login_body" ] || [ -z "$mutation_path" ]; then
    local role_upper
    role_upper="$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')"
    print_warn "$role auth gate skipped (missing ${role_upper}_LOGIN_BODY_JSON or ${role_upper}_MUTATION_PATH)"
    return 0
  fi

  local cookie_jar="$REPORT_DIR/${role}.cookies.txt"
  local tmp_dir="$REPORT_DIR/${role}-artifacts"

  run_and_capture \
    "${role}_auth_gate" \
    env \
      API_BASE="$API_BASE" \
      COOKIE_JAR="$cookie_jar" \
      TMP_DIR="$tmp_dir" \
      LOGIN_PATH="$login_path" \
      LOGIN_BODY_JSON="$login_body" \
      MUTATION_PATH="$mutation_path" \
      MUTATION_METHOD="$mutation_method" \
      MUTATION_BODY_JSON="$mutation_body" \
      ./scripts/staging-auth-gate.sh

  if [ "$AUTH_GATE_SLEEP_SECONDS" -gt 0 ]; then
    print_info "Sleeping ${AUTH_GATE_SLEEP_SECONDS}s before next role gate"
    sleep "$AUTH_GATE_SLEEP_SECONDS"
  fi
}

print_summary() {
  printf '\n'
  printf '====================================\n'
  printf 'Saiisai Consolidated Gate Summary\n'
  printf '====================================\n'
  printf 'API_BASE: %s\n' "$API_BASE"
  printf 'PASS: %s\n' "$PASS_COUNT"
  printf 'FAIL: %s\n' "$FAIL_COUNT"
  printf 'WARN: %s\n' "$WARN_COUNT"
  printf 'Logs: %s\n' "$REPORT_DIR"
  printf '====================================\n'

  if [ "$FAIL_COUNT" -gt 0 ]; then
    printf 'FINAL: NO-GO\n'
    return 1
  fi

  if [ "$WARN_COUNT" -gt 0 ]; then
    printf 'FINAL: CONDITIONAL GO (review warnings)\n'
    return 0
  fi

  printf 'FINAL: GO\n'
  return 0
}

usage() {
  cat <<EOF
Run smoke + optional auth gates in one command.

Usage:
  API_BASE=http://localhost:4000 \\
  BUYER_LOGIN_BODY_JSON='{"email":"buyer@example.com","password":"secret"}' \\
  SELLER_LOGIN_BODY_JSON='{"email":"seller@example.com","password":"secret"}' \\
  ADMIN_LOGIN_BODY_JSON='{"email":"admin@example.com","password":"secret"}' \\
  ./scripts/run-all-gates.sh

Required:
  None (smoke gate always runs)

Optional role env vars:
  BUYER_LOGIN_BODY_JSON
  BUYER_LOGIN_PATH (default: /api/v1/users/login)
  BUYER_MUTATION_PATH (default: /api/v1/users/updateMe)
  BUYER_MUTATION_METHOD (default: PATCH)
  BUYER_MUTATION_BODY_JSON (default: {"fullName":"Buyer Gate Probe"})

  SELLER_LOGIN_BODY_JSON
  SELLER_LOGIN_PATH (default: /api/v1/seller/login)
  SELLER_MUTATION_PATH (default: /api/v1/seller/profile/update)
  SELLER_MUTATION_METHOD (default: PATCH)
  SELLER_MUTATION_BODY_JSON (default: {"shopName":"Seller Gate Probe"})

  ADMIN_LOGIN_BODY_JSON
  ADMIN_LOGIN_PATH (default: /api/v1/admin/login)
  ADMIN_MUTATION_PATH (default: /api/v1/admin/profile/update)
  ADMIN_MUTATION_METHOD (default: PATCH)
  ADMIN_MUTATION_BODY_JSON (default: {"fullName":"Admin Gate Probe"})
EOF
}

main() {
  if [ "${1:-}" = "--help" ]; then
    usage
    exit 0
  fi

  BUYER_LOGIN_PATH="${BUYER_LOGIN_PATH:-/api/v1/users/login}"
  BUYER_LOGIN_BODY_JSON="${BUYER_LOGIN_BODY_JSON:-}"
  BUYER_MUTATION_PATH="${BUYER_MUTATION_PATH:-/api/v1/users/updateMe}"
  BUYER_MUTATION_METHOD="${BUYER_MUTATION_METHOD:-PATCH}"
  BUYER_MUTATION_BODY_JSON="${BUYER_MUTATION_BODY_JSON:-{\"fullName\":\"Buyer Gate Probe\"}}"

  SELLER_LOGIN_PATH="${SELLER_LOGIN_PATH:-/api/v1/seller/login}"
  SELLER_LOGIN_BODY_JSON="${SELLER_LOGIN_BODY_JSON:-}"
  SELLER_MUTATION_PATH="${SELLER_MUTATION_PATH:-/api/v1/seller/profile/update}"
  SELLER_MUTATION_METHOD="${SELLER_MUTATION_METHOD:-PATCH}"
  SELLER_MUTATION_BODY_JSON="${SELLER_MUTATION_BODY_JSON:-{\"shopName\":\"Seller Gate Probe\"}}"

  ADMIN_LOGIN_PATH="${ADMIN_LOGIN_PATH:-/api/v1/admin/login}"
  ADMIN_LOGIN_BODY_JSON="${ADMIN_LOGIN_BODY_JSON:-}"
  ADMIN_MUTATION_PATH="${ADMIN_MUTATION_PATH:-/api/v1/admin/profile/update}"
  ADMIN_MUTATION_METHOD="${ADMIN_MUTATION_METHOD:-PATCH}"
  ADMIN_MUTATION_BODY_JSON="${ADMIN_MUTATION_BODY_JSON:-{\"fullName\":\"Admin Gate Probe\"}}"

  run_smoke_gate

  run_auth_gate_for_role \
    buyer \
    "$BUYER_LOGIN_PATH" \
    "$BUYER_LOGIN_BODY_JSON" \
    "$BUYER_MUTATION_PATH" \
    "$BUYER_MUTATION_METHOD" \
    "$BUYER_MUTATION_BODY_JSON"

  run_auth_gate_for_role \
    seller \
    "$SELLER_LOGIN_PATH" \
    "$SELLER_LOGIN_BODY_JSON" \
    "$SELLER_MUTATION_PATH" \
    "$SELLER_MUTATION_METHOD" \
    "$SELLER_MUTATION_BODY_JSON"

  run_auth_gate_for_role \
    admin \
    "$ADMIN_LOGIN_PATH" \
    "$ADMIN_LOGIN_BODY_JSON" \
    "$ADMIN_MUTATION_PATH" \
    "$ADMIN_MUTATION_METHOD" \
    "$ADMIN_MUTATION_BODY_JSON"

  print_summary
}

main "$@"
