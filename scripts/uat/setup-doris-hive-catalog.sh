#!/usr/bin/env bash
# Create Doris external Hive catalog pointing at the HMS in hive.txt.
# Does not print passwords. Compatible with stock macOS bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE="$ROOT/deploy/compose/docker-compose.doris-hive-uat.yml"
HIVE_FILE="${LUCY_UAT_HIVE_FILE:-/Users/zhangxingchen/Projects/config_for_agents/hive.txt}"
MYSQL_HOST="${DORIS_MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${DORIS_MYSQL_PORT:-19030}"
CATALOG_NAME="${DORIS_HIVE_CATALOG:-hive}"

if [[ ! -f "$HIVE_FILE" ]]; then
  echo "BLOCKED: hive file missing: $HIVE_FILE" >&2
  exit 2
fi

# Parse labeled hive.txt: 地址 / 端口 / 用户/密码
eval "$(
  HIVE_FILE="$HIVE_FILE" python3 <<'PY'
import os, re, shlex
from pathlib import Path
fields = {}
for line in Path(os.environ["HIVE_FILE"]).read_text().splitlines():
    m = re.match(r"^([^：:]+)[：:]\s*(.*)$", line.strip())
    if m:
        fields[m.group(1).strip()] = m.group(2).strip()
host = fields.get("地址") or ""
ports = re.findall(r"\d+", fields.get("端口") or "")
hms_port = "9083" if "9083" in ports else (ports[-1] if ports else "9083")
cred = fields.get("用户/密码") or ""
if "/" in cred:
    user, password = cred.split("/", 1)
else:
    user, password = cred, ""
print(f"HMS_HOST={shlex.quote(host)}")
print(f"HMS_PORT={shlex.quote(hms_port)}")
print(f"HMS_USER={shlex.quote(user)}")
print(f"HMS_PASS={shlex.quote(password)}")
PY
)"

if [[ -z "${HMS_HOST}" ]]; then
  echo "BLOCKED: could not parse Hive host from $HIVE_FILE" >&2
  exit 2
fi

echo "hive_file: $HIVE_FILE"
echo "hms: thrift://${HMS_HOST}:${HMS_PORT}"
echo "hadoop.username: ${HMS_USER:-<empty>}"
echo "doris_mysql: ${MYSQL_HOST}:${MYSQL_PORT}"
echo "catalog: ${CATALOG_NAME}"

if ! docker compose -f "$COMPOSE" ps --status running 2>/dev/null | grep -q doris-fe; then
  echo "==> starting Doris FE/BE"
  docker compose -f "$COMPOSE" up -d
fi

echo "==> waiting for MySQL port ${MYSQL_PORT}"
ok=0
for i in $(seq 1 60); do
  if mysqladmin ping -h "$MYSQL_HOST" -P "$MYSQL_PORT" -uroot --protocol=TCP --connect-timeout=2 >/dev/null 2>&1 \
    || mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -uroot --protocol=TCP --connect-timeout=2 -e "SELECT 1" >/dev/null 2>&1; then
    ok=1
    break
  fi
  # fallback: /dev/tcp via bash in container
  if docker exec lucy-uat-doris-fe bash -c 'exec 3<>/dev/tcp/127.0.0.1/9030' 2>/dev/null; then
    # FE listening inside; host publish may lag — try again next loop
    :
  fi
  sleep 5
done
if [[ "$ok" -ne 1 ]]; then
  # last try with docker exec mysql client inside FE if present
  if docker exec lucy-uat-doris-fe bash -c 'command -v mysql >/dev/null' 2>/dev/null; then
    echo "host mysql client not ready; will use docker exec for SQL"
  else
    echo "BLOCKED: Doris FE MySQL ${MYSQL_HOST}:${MYSQL_PORT} not ready" >&2
    docker compose -f "$COMPOSE" ps >&2 || true
    docker logs lucy-uat-doris-fe 2>&1 | tail -40 >&2 || true
    exit 2
  fi
fi

run_sql() {
  local sql="$1"
  if command -v mysql >/dev/null 2>&1 && mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -uroot --protocol=TCP --connect-timeout=5 -e "SELECT 1" >/dev/null 2>&1; then
    mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -uroot --protocol=TCP -e "$sql"
  else
    docker exec -i lucy-uat-doris-fe mysql -h 127.0.0.1 -P 9030 -uroot -e "$sql"
  fi
}

echo "==> SHOW FRONTENDS / BACKENDS (sanity)"
run_sql "SHOW FRONTENDS\G" | head -40 || true
run_sql "SHOW BACKENDS\G" | head -40 || true

echo "==> CREATE CATALOG ${CATALOG_NAME} (idempotent drop+create)"
# Build PROPERTIES without echoing password into the shell history file content we print
PROPS="'type'='hms','hive.metastore.uris'='thrift://${HMS_HOST}:${HMS_PORT}'"
if [[ -n "${HMS_USER}" ]]; then
  PROPS="${PROPS},'hive.metastore.username'='${HMS_USER}','hadoop.username'='${HMS_USER}'"
fi

run_sql "DROP CATALOG IF EXISTS ${CATALOG_NAME};"
run_sql "CREATE CATALOG ${CATALOG_NAME} PROPERTIES (${PROPS});"

echo "==> SHOW CATALOGS / SWITCH / SHOW DATABASES"
run_sql "SHOW CATALOGS;"
run_sql "SWITCH ${CATALOG_NAME}; SHOW DATABASES;"

echo "RESULT: catalog ${CATALOG_NAME} created against thrift://${HMS_HOST}:${HMS_PORT}"
echo "Next: pick a schema+table, then Lucy connection database=${CATALOG_NAME}.<schema> host=host.docker.internal port=19030 user=root password empty"
