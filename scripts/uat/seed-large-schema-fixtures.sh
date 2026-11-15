#!/usr/bin/env bash
# Seed the scale floor for UAT-SUITE-LARGE-SCHEMA. Idempotent. Stock macOS bash 3.2.
#
#   bash scripts/uat/seed-large-schema-fixtures.sh mysql   # demo-db: uat_scale_mysql
#   bash scripts/uat/seed-large-schema-fixtures.sh hive    # local HMS+HS2, Doris external catalog
#   bash scripts/uat/seed-large-schema-fixtures.sh all     # both (default)
#   UAT_SCALE_XL=1 bash scripts/uat/seed-large-schema-fixtures.sh mysql   # also the XL table-count schema
#
# Scale floor (do not lower; see docs/qa/uat/suites/large-schema-ingestion/fixtures.md):
#   MySQL  uat_scale_mysql : 1200 tables x 10 columns + 1 table x 1000 columns   (13000 column rows)
#   Hive   uat_scale_hive  :  600 tables x 30 columns + wide tables 1500/1999/2000/3000/5000 columns
# Throwaway lab credentials only; nothing here is a customer secret.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-all}"

# ---- MySQL (demo-db) -------------------------------------------------------
DEMO_COMPOSE="${COMPOSE_FILE:-$ROOT/deploy/compose/docker-compose.demo.yml}"
DB_SERVICE="${UAT_DEMO_DB_SERVICE:-demo-db}"
DB_USER="${UAT_DEMO_DB_USER:-root}"
DB_PASSWORD="${UAT_DEMO_DB_PASSWORD:-lucy_demo_root}"
APP_DB_USER="${UAT_SCALE_MYSQL_APP_USER:-lucy}"
MYSQL_DB="${UAT_SCALE_MYSQL_DB:-uat_scale_mysql}"
MYSQL_TABLES="${UAT_SCALE_MYSQL_TABLES:-1200}"
MYSQL_COLS="${UAT_SCALE_MYSQL_COLS:-10}"
MYSQL_WIDE_COLS="${UAT_SCALE_MYSQL_WIDE_COLS:-1000}"
MYSQL_XL_DB="${UAT_SCALE_MYSQL_XL_DB:-uat_scale_mysql_xl}"
MYSQL_XL_TABLES="${UAT_SCALE_MYSQL_XL_TABLES:-12000}"

# ---- Hive + Doris ----------------------------------------------------------
HIVE_COMPOSE="$ROOT/deploy/compose/docker-compose.uat-hive-local.yml"
HS2_CONTAINER="${UAT_SCALE_HS2_CONTAINER:-lucy-uat-hive-hs2}"
HIVE_NET="${UAT_SCALE_HIVE_NET:-lucy-uat-hive}"
HIVE_DB="${UAT_SCALE_HIVE_DB:-uat_scale_hive}"
HIVE_TABLES="${UAT_SCALE_HIVE_TABLES:-600}"
HIVE_COLS="${UAT_SCALE_HIVE_COLS:-30}"
HIVE_WIDE_LIST="${UAT_SCALE_HIVE_WIDE:-1500 1999 2000 3000 5000}"
DORIS_FE="${UAT_DORIS_FE_CONTAINER:-lucy-uat-doris-fe}"
DORIS_HOST="${DORIS_MYSQL_HOST:-127.0.0.1}"
DORIS_PORT="${DORIS_MYSQL_PORT:-19030}"
DORIS_CATALOG="${UAT_SCALE_DORIS_CATALOG:-hive_scale}"
DORIS_RO_USER="${UAT_SCALE_DORIS_USER:-uat_scale_ro}"
DORIS_RO_PASS="${UAT_SCALE_DORIS_PASS:-uat_scale_pw}"
LUCY_CONTAINER="${UAT_LUCY_CONTAINER:-compose-lucy-1}"

compose_args() {
  local rest="$DEMO_COMPOSE" one
  while [ -n "$rest" ]; do
    one="${rest%%:*}"
    if [ "$one" = "$rest" ]; then rest=""; else rest="${rest#*:}"; fi
    printf -- '-f\n%s\n' "$one"
  done
}

mysql_exec() {
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(compose_args)
  docker compose "${args[@]}" exec -T "$DB_SERVICE" mysql -u"$DB_USER" -p"$DB_PASSWORD" -N -e "$1" 2>/dev/null
}

mysql_pipe() {
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(compose_args)
  docker compose "${args[@]}" exec -T "$DB_SERVICE" mysql -u"$DB_USER" -p"$DB_PASSWORD" 2>&1 | grep -v "Using a password" || true
}

count_mysql_tables() {
  mysql_exec "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$1';" | tr -d '[:space:]'
}

seed_mysql_schema() {
  local db="$1" tables="$2" cols="$3" wide="$4"
  local want="$tables"
  [ "$wide" -gt 0 ] && want=$((tables + 1))
  local have
  have="$(count_mysql_tables "$db")"; have="${have:-0}"
  echo "==> $db: $have tables present (target $want)"
  if [ "$have" -ge "$want" ]; then echo "==> $db: seed skipped"; return 0; fi
  TABLES="$tables" COLS="$cols" WIDE="$wide" DB="$db" APP_USER="$APP_DB_USER" python3 - <<'PY' | mysql_pipe
import os
db, tables, cols, wide = os.environ["DB"], int(os.environ["TABLES"]), int(os.environ["COLS"]), int(os.environ["WIDE"])
out = [f"DROP DATABASE IF EXISTS `{db}`;", f"CREATE DATABASE `{db}`;", f"USE `{db}`;"]
for i in range(1, tables + 1):
    out.append(f"CREATE TABLE t_{i:05d} (" + ", ".join(f"c{j} INT" for j in range(cols)) + ");")
if wide > 0:
    out.append(f"CREATE TABLE w_{wide} (" + ", ".join(f"c{j} INT" for j in range(wide)) + ");")
out.append(f"GRANT SELECT ON `{db}`.* TO '{os.environ['APP_USER']}'@'%';")
out.append("FLUSH PRIVILEGES;")
print("\n".join(out))
PY
  have="$(count_mysql_tables "$db")"
  echo "==> $db: $have tables after seed"
  [ "${have:-0}" -ge "$want" ] || { echo "FAILED: $db seed incomplete" >&2; exit 1; }
}

seed_mysql() {
  seed_mysql_schema "$MYSQL_DB" "$MYSQL_TABLES" "$MYSQL_COLS" "$MYSQL_WIDE_COLS"
  if [ "${UAT_SCALE_XL:-0}" = "1" ]; then
    seed_mysql_schema "$MYSQL_XL_DB" "$MYSQL_XL_TABLES" 3 0
  fi
}

beeline() {
  docker exec "$HS2_CONTAINER" beeline -u jdbc:hive2://localhost:10000/ "$@" 2>&1
}

seed_hive() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$HS2_CONTAINER"; then
    echo "==> starting local Hive (HMS + HS2)"
    docker compose -f "$HIVE_COMPOSE" up -d
  fi
  echo "==> waiting for HiveServer2 (first start takes about a minute)"
  local ok=0 i
  local probe
  for i in $(seq 1 60); do
    # Capture first: `grep -q` closing the pipe early would trip pipefail.
    probe="$(beeline -e "show databases;" 2>/dev/null || true)"
    case "$probe" in *default*) ok=1; break ;; esac
    sleep 5
  done
  [ "$ok" -eq 1 ] || { echo "BLOCKED: HiveServer2 not ready" >&2; exit 2; }

  local have want
  want=$((HIVE_TABLES + $(echo "$HIVE_WIDE_LIST" | wc -w | tr -d ' ')))
  have="$(beeline --silent=true --outputformat=tsv2 -e "show tables in $HIVE_DB;" 2>/dev/null | grep -c '^[tw]_' || true)"
  echo "==> hive $HIVE_DB: $have tables present (target $want)"
  if [ "${have:-0}" -lt "$want" ]; then
    local sql
    sql="$(mktemp -t uat-scale-hive.XXXXXX)"
    HIVE_DB="$HIVE_DB" TABLES="$HIVE_TABLES" COLS="$HIVE_COLS" WIDE="$HIVE_WIDE_LIST" python3 - >"$sql" <<'PY'
import os
db, tables, cols = os.environ["HIVE_DB"], int(os.environ["TABLES"]), int(os.environ["COLS"])
out = [f"CREATE DATABASE IF NOT EXISTS {db};"]
for i in range(1, tables + 1):
    out.append(f"CREATE TABLE IF NOT EXISTS {db}.t_{i:04d} (" + ", ".join(f"c{j} {'BIGINT' if j % 3 == 0 else 'STRING'}" for j in range(cols)) + ") STORED AS PARQUET;")
for n in [int(x) for x in os.environ["WIDE"].split()]:
    out.append(f"CREATE TABLE IF NOT EXISTS {db}.w_{n} (" + ", ".join(f"c{j} STRING" for j in range(n)) + ") STORED AS PARQUET;")
print("\n".join(out))
PY
    docker cp "$sql" "$HS2_CONTAINER:/tmp/uat-scale.sql"
    docker exec -u 0 "$HS2_CONTAINER" chmod 644 /tmp/uat-scale.sql
    rm -f "$sql"
    echo "==> creating Hive tables (about a minute)"
    beeline -f /tmp/uat-scale.sql >/dev/null || true
    have="$(beeline --silent=true --outputformat=tsv2 -e "show tables in $HIVE_DB;" 2>/dev/null | grep -c '^[tw]_' || true)"
    echo "==> hive $HIVE_DB: $have tables after seed"
    [ "${have:-0}" -ge "$want" ] || { echo "FAILED: hive seed incomplete" >&2; exit 1; }
  fi

  echo "==> joining Doris FE ($DORIS_FE) and Lucy ($LUCY_CONTAINER) to network $HIVE_NET"
  docker network connect "$HIVE_NET" "$DORIS_FE" 2>/dev/null || true
  docker network connect "$HIVE_NET" "$LUCY_CONTAINER" 2>/dev/null || true

  command -v mysql >/dev/null || { echo "BLOCKED: host mysql client missing" >&2; exit 2; }
  local dm=(mysql -h"$DORIS_HOST" -P"$DORIS_PORT" -uroot --protocol=TCP --connect-timeout=10)
  echo "==> Doris catalog $DORIS_CATALOG -> thrift://lucy-uat-hive-hms:9083"
  "${dm[@]}" -e "CREATE CATALOG IF NOT EXISTS \`$DORIS_CATALOG\` PROPERTIES ('type'='hms','hive.metastore.uris'='thrift://lucy-uat-hive-hms:9083');"
  "${dm[@]}" -e "CREATE USER IF NOT EXISTS '$DORIS_RO_USER'@'%' IDENTIFIED BY '$DORIS_RO_PASS'; GRANT SELECT_PRIV ON \`$DORIS_CATALOG\`.\`$HIVE_DB\`.* TO '$DORIS_RO_USER'@'%'; REFRESH CATALOG \`$DORIS_CATALOG\`;"
  local seen
  seen="$("${dm[@]}" -N -e "SHOW TABLES FROM \`$DORIS_CATALOG\`.\`$HIVE_DB\`;" | wc -l | tr -d ' ')"
  echo "==> Doris sees $seen tables in $DORIS_CATALOG.$HIVE_DB (target $want)"
  [ "${seen:-0}" -ge "$want" ] || { echo "FAILED: Doris does not see the Hive tables" >&2; exit 1; }
}

case "$MODE" in
  mysql) seed_mysql ;;
  hive) seed_hive ;;
  all) seed_mysql; seed_hive ;;
  *) echo "usage: $0 [mysql|hive|all]" >&2; exit 2 ;;
esac
echo "==> large-schema fixtures ready ($MODE)"
