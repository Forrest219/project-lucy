#!/usr/bin/env bash
# Post-deploy acceptance for Lucy on Kubernetes (H5 gate).
#
# Usage:
#   bash scripts/k8s-acceptance.sh \
#     --namespace lucy-test \
#     --release lucy \
#     --public-mcp-url http://10.69.95.109:8277/mcp \
#     [--token <bearer>] \
#     [--webui-port 8276] \
#     [--connection kc-starrocks]
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/k8s-gate-lib.sh
source "${ROOT}/scripts/k8s-gate-lib.sh"

NAMESPACE=""
RELEASE=""
PUBLIC_MCP_URL=""
TOKEN=""
WEBUI_PORT=""
CONNECTION="kc-starrocks"
SKIP_MCP=0
SKIP_KTX=0

usage() {
  cat <<'EOF'
Usage: bash scripts/k8s-acceptance.sh --namespace <ns> --release <name> [options]

Required:
  --namespace <ns>           Kubernetes namespace
  --release <name>           Helm release / deployment name

Options:
  --public-mcp-url <url>     External MCP URL (required unless --skip-mcp)
  --token <bearer>           MCP bearer token (required unless --skip-mcp)
  --webui-port <port>        Service WebUI port for port-forward (default: service spec)
  --connection <name>        ktx connection to test (default: kc-starrocks)
  --skip-mcp                 Skip MCP handshake checks
  --skip-ktx                 Skip ktx exec checks (health only)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --public-mcp-url) PUBLIC_MCP_URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --webui-port) WEBUI_PORT="$2"; shift 2 ;;
    --connection) CONNECTION="$2"; shift 2 ;;
    --skip-mcp) SKIP_MCP=1; shift ;;
    --skip-ktx) SKIP_KTX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "${NAMESPACE}" ]] || fail "--namespace is required"
[[ -n "${RELEASE}" ]] || fail "--release is required"
if [[ "${SKIP_MCP}" -eq 0 ]]; then
  [[ -n "${PUBLIC_MCP_URL}" ]] || fail "--public-mcp-url is required (or use --skip-mcp)"
  [[ -n "${TOKEN}" ]] || fail "--token is required (or use --skip-mcp)"
fi

require_cmd kubectl
require_cmd curl

wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600

if [[ -z "${WEBUI_PORT}" ]]; then
  WEBUI_PORT="$(kubectl -n "${NAMESPACE}" get svc "${RELEASE}" -o jsonpath='{.spec.ports[?(@.name=="webui")].port}')"
fi
[[ -n "${WEBUI_PORT}" ]] || fail "could not determine webui service port"

log "port-forward svc/${RELEASE} ${WEBUI_PORT}:${WEBUI_PORT}"
kubectl -n "${NAMESPACE}" port-forward "svc/${RELEASE}" "${WEBUI_PORT}:${WEBUI_PORT}" >/dev/null 2>&1 &
PF_PID=$!
cleanup() { kill "${PF_PID}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
sleep 2

BASE_URL="http://127.0.0.1:${WEBUI_PORT}"

log "GET /api/health"
HEALTH="$(curl_health "${BASE_URL}")"
printf '%s\n' "${HEALTH}" | grep -q '"ok":true' || fail "/api/health envelope not ok"
printf '%s\n' "${HEALTH}" | grep -q 'bundledKtxVersion' || fail "/api/health missing bundledKtxVersion"

if [[ "${SKIP_KTX}" -eq 0 ]]; then
  EXPECTED_KTX="${KTX_VERSION:-${LUCY_EXPECTED_KTX_VERSION:-0.16.0}}"
  log "ktx --version (expect ${EXPECTED_KTX})"
  KTX_VER="$(kubectl_exec "${NAMESPACE}" "${RELEASE}" ktx --version)"
  printf '%s\n' "${KTX_VER}" | grep -q "${EXPECTED_KTX}" || fail "unexpected ktx version: ${KTX_VER}"

  log "ktx connection test ${CONNECTION}"
  kubectl_exec "${NAMESPACE}" "${RELEASE}" \
    ktx --project-dir /data/lucy connection test "${CONNECTION}"

  log "ktx admin reindex --force"
  kubectl_exec "${NAMESPACE}" "${RELEASE}" \
    ktx --project-dir /data/lucy admin reindex --force --output json >/dev/null
fi

if [[ "${SKIP_MCP}" -eq 0 ]]; then
  log "MCP initialize without token (expect 401)"
  set +e
  MCP_NO_AUTH="$(curl -sS -o /tmp/lucy-mcp-noauth.out -w '%{http_code}' -X POST "${PUBLIC_MCP_URL}" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"acceptance","version":"1.0"}}}')"
  set -e
  [[ "${MCP_NO_AUTH}" == "401" ]] || fail "expected MCP 401 without token, got ${MCP_NO_AUTH}"

  log "MCP initialize with token"
  INIT_BODY='{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"acceptance","version":"1.0"}}}'
  INIT_RESP="$(mcp_post "${PUBLIC_MCP_URL}" "${TOKEN}" "${INIT_BODY}")"
  printf '%s\n' "${INIT_RESP}" | grep -q 'lucy-mcp-proxy' || fail "MCP initialize missing lucy-mcp-proxy"

  log "MCP tools/list"
  LIST_BODY='{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}'
  LIST_RESP="$(mcp_post "${PUBLIC_MCP_URL}" "${TOKEN}" "${LIST_BODY}")"
  printf '%s\n' "${LIST_RESP}" | grep -q 'tools' || fail "MCP tools/list unexpected response"
fi

log "OK — acceptance passed"
