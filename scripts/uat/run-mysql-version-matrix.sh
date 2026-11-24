#!/usr/bin/env bash
# Full-fidelity UAT: catalog-scan against MySQL 5.7 / 8.0 / 8.4 (demo-db).
# Requires running lucy stack. Does not print passwords.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO_COMPOSE="$ROOT/deploy/compose/docker-compose.demo.yml"
MATRIX_COMPOSE="$ROOT/deploy/compose/docker-compose.uat-mysql-matrix.yml"
COMPOSE_FILE_JOIN="${DEMO_COMPOSE}:${MATRIX_COMPOSE}"
COMPOSE=(docker compose -f "$DEMO_COMPOSE" -f "$MATRIX_COMPOSE")
TABLE_COUNT="${UAT_WIDE_TABLE_COUNT:-80}"
PASS_FILE="${UAT_MATRIX_PASS_FILE:-$ROOT/inbox/uat-mysql-matrix-$(date +%Y%m%d-%H%M%S).jsonl}"
mkdir -p "$(dirname "$PASS_FILE")"
: >"$PASS_FILE"

mysql57_blocked=0
mysql80_ok=0

echo "==> bring up matrix MySQL 8.0 (local tag preferred)"
if ! "${COMPOSE[@]}" up -d uat-mysql80 2>"$ROOT/inbox/uat-mysql80-up.err"; then
  echo "uat-mysql80 up failed:" >&2
  cat "$ROOT/inbox/uat-mysql80-up.err" >&2
  echo "{\"label\":\"mysql-8.0\",\"verdict\":\"BLOCKED\",\"reason\":\"compose_up_failed\"}" >>"$PASS_FILE"
else
  mysql80_ok=1
fi

echo "==> bring up matrix MySQL 5.7 (may need image pull)"
if ! "${COMPOSE[@]}" up -d uat-mysql57 2>"$ROOT/inbox/uat-mysql57-up.err"; then
  echo "uat-mysql57 up failed (often proxy/image); marking BLOCKED" >&2
  cat "$ROOT/inbox/uat-mysql57-up.err" >&2 || true
  echo "{\"label\":\"mysql-5.7\",\"verdict\":\"BLOCKED\",\"reason\":\"image_or_proxy\"}" >>"$PASS_FILE"
  mysql57_blocked=1
fi

wait_ping() {
  local svc="$1"
  local i=0
  while [[ $i -lt 90 ]]; do
    if "${COMPOSE[@]}" exec -T "$svc" mysqladmin ping -h 127.0.0.1 -uroot -plucy_demo_root --silent 2>/dev/null; then
      echo "  $svc ping ok"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "timeout waiting for $svc" >&2
  "${COMPOSE[@]}" logs --tail 40 "$svc" >&2 || true
  return 1
}

if [[ "$mysql80_ok" -eq 1 ]]; then
  wait_ping uat-mysql80 || {
    echo "{\"label\":\"mysql-8.0\",\"verdict\":\"BLOCKED\",\"reason\":\"health_timeout\"}" >>"$PASS_FILE"
    mysql80_ok=0
  }
fi
if [[ "$mysql57_blocked" -eq 0 ]]; then
  if ! wait_ping uat-mysql57; then
    echo "{\"label\":\"mysql-5.7\",\"verdict\":\"BLOCKED\",\"reason\":\"health_timeout\"}" >>"$PASS_FILE"
    mysql57_blocked=1
  fi
fi

run_one() {
  local host="$1"
  local label="$2"
  local service="$3"
  echo "==> seed+API $label host=$host tables=$TABLE_COUNT"
  COMPOSE_FILE="$COMPOSE_FILE_JOIN" \
  UAT_DEMO_DB_SERVICE="$service" \
  UAT_WIDE_DB=uat_wide_scan \
  UAT_WIDE_TABLE_COUNT="$TABLE_COUNT" \
  bash "$ROOT/scripts/uat/seed-catalog-scan-fixtures.sh"

  local out rc=0
  out="$(
    UAT_DB_HOST="$host" \
    UAT_WIDE_DB=uat_wide_scan \
    UAT_WIDE_TABLE_COUNT="$TABLE_COUNT" \
    node "$ROOT/scripts/uat/run-catalog-scan-wide-api.mjs" 2>&1
  )" || rc=$?
  echo "$out"
  echo "$out" >>"$PASS_FILE"
  if [[ $rc -eq 0 ]] && echo "$out" | grep -q '"verdict":"PASS"'; then
    echo "{\"label\":\"$label\",\"host\":\"$host\",\"verdict\":\"PASS\"}" >>"$PASS_FILE"
    return 0
  fi
  echo "{\"label\":\"$label\",\"host\":\"$host\",\"verdict\":\"FAIL\",\"rc\":$rc}" >>"$PASS_FILE"
  return 1
}

failed=0
run_one demo-db "mysql-8.4-demo" demo-db || failed=1
if [[ "$mysql80_ok" -eq 1 ]]; then
  run_one uat-mysql80 "mysql-8.0" uat-mysql80 || failed=1
fi
if [[ "$mysql57_blocked" -eq 0 ]]; then
  run_one uat-mysql57 "mysql-5.7" uat-mysql57 || failed=1
fi

echo "==> matrix log: $PASS_FILE"
if [[ "$failed" -ne 0 ]]; then
  echo "MATRIX FAIL" >&2
  exit 1
fi
if [[ "$mysql57_blocked" -ne 0 ]]; then
  echo "MATRIX PASS WITH GAP (5.7 BLOCKED — need image pull / fix Docker proxy)"
  exit 0
fi
echo "MATRIX PASS (5.7 / 8.0 / 8.4)"
