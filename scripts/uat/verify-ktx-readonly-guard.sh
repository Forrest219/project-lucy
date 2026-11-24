#!/usr/bin/env bash
# UAT-SCAN-KTX-GUARD: run the REAL KTX read-only SQL validator inside the lucy container.
#
# Why: `ktx sql` only admits SELECT/UNION roots. DESC/DESCRIBE/SHOW are refused, so the
# external-catalog column probes must stay on the direct channel (P1-20). The vitest
# double mirrors this; this script proves the double still matches the shipped KTX.
#
# Exit: 0 all expectations hold | 1 an expectation is wrong (KTX behaviour changed)
#       2 validator not reachable (container/runtime missing) -> BLOCKED, not PASS.
# Prints no secrets. Compatible with stock macOS bash 3.2.
set -euo pipefail

CONTAINER="${UAT_LUCY_CONTAINER:-compose-lucy-1}"

if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "BLOCKED: container $CONTAINER is not running" >&2
  exit 2
fi

echo "container: $CONTAINER"
echo "ktx: $(docker exec "$CONTAINER" ktx --version 2>&1 | head -1)"

set +e
docker exec -i "$CONTAINER" sh -c '
DAEMON_DIR=$(find /home/lucy/.cache/uv/archive-v0 -type d -name ktx_daemon 2>/dev/null | head -1)
PY=$(ls /home/lucy/.ktx/runtime/*/.venv/bin/python 2>/dev/null | head -1)
if [ -z "$DAEMON_DIR" ] || [ -z "$PY" ]; then
  echo "BLOCKED: ktx_daemon or its python runtime not found" >&2
  exit 2
fi
cd "$(dirname "$DAEMON_DIR")" && exec "$PY" -
' <<'PYEOF'
import sys

try:
    from ktx_daemon.sql_analysis import (
        ValidateReadOnlySqlRequest as Request,
        validate_read_only_sql_response as validate,
    )
except Exception as exc:  # noqa: BLE001
    print(f"BLOCKED: cannot import the KTX validator: {exc}", file=sys.stderr)
    sys.exit(2)

T = "`hive`.`dim`.`dim_bidding_block_ad_id_2025`"
# (statement, must_pass)
CASES = [
    (f"DESC {T}", False),
    (f"DESCRIBE {T}", False),
    (f"SHOW COLUMNS FROM {T}", False),
    ("SHOW TABLES FROM `hive`.`dim`", False),
    ("SHOW DATABASES FROM `hive`", False),
    ("SELECT 1", True),
]
DIALECTS = ["mysql", "starrocks", "doris"]

bad = 0
for dialect in DIALECTS:
    for sql, must_pass in CASES:
        res = validate(Request(sql=sql, dialect=dialect))
        ok = bool(res.ok)
        verdict = "OK " if ok == must_pass else "BAD"
        if ok != must_pass:
            bad += 1
        want = "accept" if must_pass else "reject"
        got = "accept" if ok else f"reject ({(res.error or '').splitlines()[0][:60]})"
        print(f"{verdict} {dialect:<9} want {want:<6} got {got} :: {sql[:40]}")

print("RESULT:", "PASS" if bad == 0 else f"FAIL ({bad} mismatches)")
sys.exit(0 if bad == 0 else 1)
PYEOF
code=$?
set -e
exit "$code"
