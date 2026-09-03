#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="${UPGRADE_TEST_ROOT:-/Users/zhangxingchen/Nutstore Files/AI Projects/202808-lucy-test}"
WEBUI="${LUCY_UPGRADE_WEBUI:-http://127.0.0.1:55177}"
CREDS_FILE="${UPGRADE_CREDS_FILE:-${TEST_ROOT}/账号密码.txt}"
PARSE_SCRIPT="${TEST_ROOT}/auto-config/scripts/parse-mysql-aliyun-creds.py"

cd "${ROOT}"

python3 "${PARSE_SCRIPT}" --credentials-file "${CREDS_FILE}" --check
python3 "${PARSE_SCRIPT}" --credentials-file "${CREDS_FILE}" --export-shell /tmp/lucy-upgrade-uat-creds.env

set -a
# shellcheck disable=SC1091
source /tmp/lucy-upgrade-uat-creds.env
set +a
export LUCY_DB_HOST="${LUCY_MYSQL_HOST}"
export LUCY_DB_PORT="${LUCY_MYSQL_PORT}"
export LUCY_DB_USER="${LUCY_MYSQL_USER}"
export LUCY_DB_PASS="${LUCY_MYSQL_PASSWORD}"

python3 "${TEST_ROOT}/auto-config/scripts/run-conn-webui.py" --webui "${WEBUI}"
python3 "${TEST_ROOT}/auto-config/scripts/run-adm-webui.py" --webui "${WEBUI}"

echo "[upgrade-uat-bootstrap] done; token file: /tmp/lucy-macpro-m4-fast.token"
