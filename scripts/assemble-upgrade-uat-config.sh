#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="${UPGRADE_TEST_ROOT:-/Users/zhangxingchen/Nutstore Files/AI Projects/202808-lucy-test}"
CONFIG_ROOT="${UPGRADE_CONFIG_ROOT:-${TEST_ROOT}/customer-config}"
CREDS_FILE="${UPGRADE_CREDS_FILE:-${TEST_ROOT}/账号密码.txt}"
PARSE_SCRIPT="${TEST_ROOT}/auto-config/scripts/parse-mysql-aliyun-creds.py"

link_or_copy_dir() {
  local src="$1"
  local dest="$2"
  if [[ -L "${dest}" || -e "${dest}" ]]; then
    rm -rf "${dest}"
  fi
  cp -R "${src}" "${dest}"
}

mkdir -p "${CONFIG_ROOT}/webui/config" "${CONFIG_ROOT}/.ktx/secrets" "${CONFIG_ROOT}/.ktx-ui"

link_or_copy_dir "${TEST_ROOT}/semantic-layer" "${CONFIG_ROOT}/semantic-layer"
link_or_copy_dir "${TEST_ROOT}/wiki" "${CONFIG_ROOT}/wiki"
link_or_copy_dir "${TEST_ROOT}/evals" "${CONFIG_ROOT}/evals"
link_or_copy_dir "${TEST_ROOT}/skills" "${CONFIG_ROOT}/skills"

cat > "${CONFIG_ROOT}/ktx.yaml" <<EOF
connections:
  mysql-aliyun:
    driver: mysql
    readonly: true
    host: PLACEHOLDER_HOST
    port: 3306
    database: chatbi
    username: bi_zy
    password: file:/data/lucy/.ktx/secrets/mysql-aliyun-password
    schemas:
      - chatbi
    enabled_tables: []
storage:
  state: sqlite
  search: sqlite-fts5
  git:
    author: lucy <lucy@upgrade-uat.local>
agent:
  run_research:
    enabled: false
setup:
  database_connection_ids:
    - mysql-aliyun
EOF

if [[ -f "${PARSE_SCRIPT}" ]]; then
  HOST="$(python3 "${PARSE_SCRIPT}" --credentials-file "${CREDS_FILE}" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["host"])')"
  sed -i '' "s/PLACEHOLDER_HOST/${HOST}/" "${CONFIG_ROOT}/ktx.yaml"
fi

cat > "${CONFIG_ROOT}/webui/config/access.yaml" <<'EOF'
roles:
  chatbi-analyst:
    description: Upgrade UAT prod_min readonly role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: chatbi
          names:
            - ai_intl_ad_daily
            - ai_intl_country_daily
            - ai_intl_retention_daily
            - ai_intl_user_active_30d_uv_daily
      tools:
        - lucy_begin_question
        - lucy_catalog
        - lucy_explain_query
        - lucy_freshness
        - lucy_query
        - lucy_read_source

users:
  - id: upgrade-uat-agent
    name: Upgrade UAT Agent
    enabled: true
    note: Placeholder hash; CFG-ADM-01 replaces with real token hashes.
    tokens:
      - hash: sha256:8ccee2d00afbe164425d51333fe42a3e5a7381955e555a69c185edb8783018f7
        label: upgrade-uat-placeholder
        created: 2026-09-01
    role: chatbi-analyst

defaults:
  deny_tools:
    - sql_execution
    - sql_dialect_notes
    - memory_ingest
    - memory_ingest_status
  known_tools:
    - lucy_begin_question
    - lucy_catalog
    - lucy_explain_query
    - lucy_freshness
    - lucy_query
    - lucy_read_source
    - wiki_search
    - wiki_read
    - connection_list
  table_touching_tools:
    - lucy_query
    - lucy_read_source
  sensitive_metadata_tools: []
  sensitive_table_prefixes: []
EOF

touch "${CONFIG_ROOT}/.ktx-ui/.gitkeep"
chmod 700 "${CONFIG_ROOT}/.ktx/secrets"

if [[ ! -f "${PARSE_SCRIPT}" ]]; then
  echo "[assemble-upgrade-uat-config] WARN: ${PARSE_SCRIPT} missing; secret file not written" >&2
else
  python3 "${PARSE_SCRIPT}" --credentials-file "${CREDS_FILE}" --check
  CREDS_FILE="${CREDS_FILE}" CONFIG_ROOT="${CONFIG_ROOT}" python3 - <<'PY'
from pathlib import Path
import os
import re

creds_file = Path(os.environ["CREDS_FILE"])
config_root = Path(os.environ["CONFIG_ROOT"])
text = creds_file.read_text(encoding="utf-8")
head = text.split("---", 1)[0]
lines = [ln.rstrip() for ln in head.splitlines()]

def line_value(i: int) -> str:
    j = i + 1
    while j < len(lines) and not lines[j].strip():
        j += 1
    return lines[j].strip() if j < len(lines) else ""

parsed = {}
for i, line in enumerate(lines):
    key = line.strip().rstrip(":").lower()
    if key == "hostname":
        parsed["host"] = line_value(i)
    elif key == "port":
        parsed["port"] = line_value(i)
    elif key == "username":
        parsed["username"] = line_value(i)
    elif key == "password":
        parsed["password"] = line_value(i)

errors = []
for field in ("host", "port", "username", "password"):
    if not parsed.get(field):
        errors.append(f"missing_{field}")
if parsed.get("username", "").lower() == "admin":
    errors.append("forbidden_username")
if parsed.get("username") and parsed.get("username") != "bi_zy":
    errors.append(f"unexpected_username:{parsed.get('username')}")
if parsed.get("host") and not re.search(r"\.mysql\.rds\.aliyuncs\.com", parsed["host"], re.I):
    errors.append(f"host_not_rds:{parsed.get('host')}")
if errors:
    raise SystemExit(f"credential validation failed: {errors}")

secret = config_root / ".ktx/secrets/mysql-aliyun-password"
secret.write_text(parsed["password"], encoding="utf-8")
secret.chmod(0o600)
print(f"[assemble-upgrade-uat-config] wrote {secret}")
PY
fi

echo "[assemble-upgrade-uat-config] layout ready at ${CONFIG_ROOT}"
