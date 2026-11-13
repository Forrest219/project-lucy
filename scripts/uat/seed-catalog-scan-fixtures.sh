#!/usr/bin/env bash
# Seed local demo-db fixtures for UAT-SUITE-CATALOG-SCAN / CONN-RELOAD.
# Idempotent. Does not print or require customer secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Colon-separated compose files (demo + optional matrix overlay).
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/compose/docker-compose.demo.yml}"
DB_SERVICE="${UAT_DEMO_DB_SERVICE:-demo-db}"
DB_USER="${UAT_DEMO_DB_USER:-root}"
DB_PASSWORD="${UAT_DEMO_DB_PASSWORD:-lucy_demo_root}"
WIDE_DB="${UAT_WIDE_DB:-uat_wide_scan}"
RELOAD_DB="${UAT_RELOAD_DB:-e2e_conn_reload}"
TABLE_COUNT="${UAT_WIDE_TABLE_COUNT:-200}"
COLS_PER_TABLE="${UAT_WIDE_COLS:-5}"

COMPOSE_ARGS=()
_rest="$COMPOSE_FILE"
while [ -n "$_rest" ]; do
  _one="${_rest%%:*}"
  if [ "$_one" = "$_rest" ]; then
    _rest=""
  else
    _rest="${_rest#*:}"
  fi
  COMPOSE_ARGS+=(-f "$_one")
done

if ! docker compose "${COMPOSE_ARGS[@]}" ps --status running -q "$DB_SERVICE" >/dev/null 2>&1; then
  if ! docker compose "${COMPOSE_ARGS[@]}" ps -q "$DB_SERVICE" | grep -q .; then
    echo "db service $DB_SERVICE not found via $COMPOSE_FILE" >&2
    exit 1
  fi
fi

mysql_exec() {
  docker compose "${COMPOSE_ARGS[@]}" exec -T "$DB_SERVICE" \
    mysql -u"$DB_USER" -p"$DB_PASSWORD" -N -e "$1" 2>/dev/null
}

echo "==> ensuring databases ${WIDE_DB} ${RELOAD_DB}"
mysql_exec "CREATE DATABASE IF NOT EXISTS \`${WIDE_DB}\`; CREATE DATABASE IF NOT EXISTS \`${RELOAD_DB}\`;"

existing="$(mysql_exec "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${WIDE_DB}';" | tr -d '[:space:]')"
existing="${existing:-0}"
echo "==> ${WIDE_DB} existing tables: ${existing} (target ${TABLE_COUNT})"

if [[ "$existing" -ge "$TABLE_COUNT" ]]; then
  echo "==> seed skipped (already >= target)"
else
  echo "==> creating tables $((existing + 1))..${TABLE_COUNT}"
  # Batch DDL to keep runtime reasonable on stock bash 3.2 / Mac.
  batch=""
  i=$((existing + 1))
  while [[ "$i" -le "$TABLE_COUNT" ]]; do
    cols="id INT PRIMARY KEY"
    c=1
    while [[ "$c" -le "$COLS_PER_TABLE" ]]; do
      cols="${cols}, c${c} VARCHAR(32) NULL"
      c=$((c + 1))
    done
    batch="${batch}CREATE TABLE IF NOT EXISTS \`${WIDE_DB}\`.\`uat_t$(printf '%04d' "$i")\` (${cols});"
    if [[ $((i % 25)) -eq 0 ]] || [[ "$i" -eq "$TABLE_COUNT" ]]; then
      mysql_exec "$batch"
      batch=""
      echo "  ... through ${i}"
    fi
    i=$((i + 1))
  done
fi

final="$(mysql_exec "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${WIDE_DB}';" | tr -d '[:space:]')"
col_rows="$(mysql_exec "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='${WIDE_DB}';" | tr -d '[:space:]')"
echo "==> done: tables=${final} column_rows=${col_rows}"
echo "OK seed-catalog-scan-fixtures"
