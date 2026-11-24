#!/usr/bin/env bash
# UAT-SUITE-ACCESS-MAP-SANKEY：每个种子 profile 起一个一次性容器（同一镜像 project-lucy:demo）。
# 不碰 demo 容器、demo 数据卷、demo 审计库。兼容 macOS bash 3.2。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BASE="${SANKEY_DOCKER_BASE:-/tmp/lucy-sankey-docker}"
IMAGE="${SANKEY_IMAGE:-project-lucy:demo}"
i=1
for p in grants-only rich sparse candidate-only dense; do
  port=$((58300 + i)); i=$((i + 1))
  (cd "$ROOT/webui" && SANKEY_PROFILE="$p" SANKEY_DATA="$BASE/$p/data" npx tsx ../scripts/uat/sankey-docker/seed.mts >/dev/null)
  chmod -R a+rwX "$BASE/$p/data"
  docker rm -f "lucy-uat-sankey-$p" >/dev/null 2>&1 || true
  docker run -d --name "lucy-uat-sankey-$p" -p "$port:5174" -v "$BASE/$p/data:/data/lucy" \
    -e KTX_PROJECT_ROOT=/data/lucy -e LUCY_TEMPLATE_ROOT=/app/examples/docker-demo/project-template \
    -e LUCY_WEBUI_HOST=0.0.0.0 -e LUCY_WEBUI_PORT=5174 -e LUCY_PROXY_HOST=0.0.0.0 -e LUCY_PROXY_PORT=7879 \
    -e LUCY_PROXY_UPSTREAM_HOST=127.0.0.1 -e LUCY_PROXY_UPSTREAM_PORT=7878 -e LUCY_CONTENT_ROOT=/data/lucy/config \
    -e LUCY_DEPLOYMENT_MODE=development -e LUCY_CHART_DEPLOYMENT_MODE=development -e LUCY_WEBUI_AUTH=off \
    -e POSTHOG_DISABLED=1 "$IMAGE" >/dev/null
  echo "started lucy-uat-sankey-$p on :$port"
done
echo "等待 healthy（约 60 秒）：docker ps --filter name=lucy-uat-sankey"
