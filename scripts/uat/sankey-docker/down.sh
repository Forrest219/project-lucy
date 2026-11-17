#!/usr/bin/env bash
# 删除 up.sh 起的一次性容器与数据目录。
set -euo pipefail
BASE="${SANKEY_DOCKER_BASE:-/tmp/lucy-sankey-docker}"
for p in grants-only rich sparse candidate-only dense; do
  docker rm -f "lucy-uat-sankey-$p" >/dev/null 2>&1 || true
done
rm -rf "$BASE"
echo "removed"
