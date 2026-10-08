#!/usr/bin/env bash
# Post-deploy acceptance for Lucy on Kubernetes (H5 gate).
#
# Works from the repo (scripts/gates/) and from an extracted delivery package
# (scripts/acceptance.sh) — k8s-gate-lib.sh sits next to this script in both.
#
# Release, Deployment and Service names are independent. Example for the
# lucy-test environment (release lucy-starrocks, workload/service lucy):
#
#   LUCY_MCP_TOKEN=<bearer> bash scripts/acceptance.sh \
#     --namespace lucy-test \
#     --release lucy-starrocks \
#     --deployment lucy --service lucy \
#     --public-mcp-url http://10.69.95.109:8277/mcp \
#     --connection kc-starrocks --connection rds-test --connection zijin \
#     --expect-content-root .
#
# The bearer token is read from $LUCY_MCP_TOKEN (preferred) or --token-file.
# It is never echoed, never put on a curl command line, and never written to
# the acceptance output. Secret contents and DB passwords are never read.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/k8s-gate-lib.sh
source "${SCRIPT_DIR}/k8s-gate-lib.sh"

NAMESPACE=""
RELEASE=""
DEPLOYMENT=""
SERVICE=""
PUBLIC_MCP_URL=""
TOKEN="${LUCY_MCP_TOKEN:-}"
TOKEN_FILE=""
WEBUI_URL=""
WEBUI_CONTAINER_PORT="5174"
CONNECTIONS=()
EXPECT_CONTENT_ROOT=""
SKIP_MCP=0
SKIP_KTX=0
SKIP_HELM=0
SKIP_SECRETS=0

usage() {
  cat <<'EOF'
Usage: bash scripts/acceptance.sh --namespace <ns> --release <helm-release> [options]

Required:
  --namespace <ns>             Kubernetes namespace
  --release <name>             Helm release name (NOT necessarily the Deployment name)

Names (default to the release when omitted):
  --deployment <name>          Deployment name (chart fullname / fullnameOverride)
  --service <name>             Service name (default: deployment name)

Options:
  --public-mcp-url <url>       External MCP URL (required unless --skip-mcp)
  --token-file <path>          File holding the bearer token (or set LUCY_MCP_TOKEN)
  --webui-url <url>            Also check /api/health through this external URL
  --connection <id>            ktx connection to test; repeatable (default: kc-starrocks)
  --expect-content-root <v>    Fail unless the pod's LUCY_CONTENT_ROOT equals <v> (e.g. ".")
  --skip-mcp                   Skip MCP handshake checks
  --skip-ktx                   Skip ktx exec checks (health/secret checks only)
  --skip-helm                  Skip `helm status` (helm not installed on this host)
  --skip-secrets-check         Skip the .ktx/secrets owner/mode/mount checks (only when judging a
                               rollback to a chart older than 0.2.3)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --deployment) DEPLOYMENT="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --public-mcp-url) PUBLIC_MCP_URL="$2"; shift 2 ;;
    --token-file) TOKEN_FILE="$2"; shift 2 ;;
    --webui-url) WEBUI_URL="$2"; shift 2 ;;
    --connection) CONNECTIONS+=("$2"); shift 2 ;;
    --expect-content-root) EXPECT_CONTENT_ROOT="$2"; shift 2 ;;
    --skip-mcp) SKIP_MCP=1; shift ;;
    --skip-ktx) SKIP_KTX=1; shift ;;
    --skip-helm) SKIP_HELM=1; shift ;;
    --skip-secrets-check) SKIP_SECRETS=1; shift ;;
    --token) fail "--token is not accepted (it would leak into the process list); use LUCY_MCP_TOKEN or --token-file" ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "${NAMESPACE}" ]] || fail "--namespace is required"
[[ -n "${RELEASE}" ]] || fail "--release is required"
[[ -n "${DEPLOYMENT}" ]] || DEPLOYMENT="${RELEASE}"
[[ -n "${SERVICE}" ]] || SERVICE="${DEPLOYMENT}"
if [[ -n "${TOKEN_FILE}" ]]; then
  [[ -r "${TOKEN_FILE}" ]] || fail "--token-file not readable"
  TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}")"
fi
if [[ "${SKIP_MCP}" -eq 0 ]]; then
  [[ -n "${PUBLIC_MCP_URL}" ]] || fail "--public-mcp-url is required (or use --skip-mcp)"
  [[ -n "${TOKEN}" ]] || fail "bearer token required: set LUCY_MCP_TOKEN or --token-file (or use --skip-mcp)"
fi
if [[ "${#CONNECTIONS[@]}" -eq 0 ]]; then
  CONNECTIONS=("kc-starrocks")
fi

# k8s-gate-lib resolves workload/service names from these.
export K8S_GATE_DEPLOYMENT="${DEPLOYMENT}"
export K8S_GATE_SERVICE="${SERVICE}"

require_cmd kubectl
require_cmd curl
require_cmd python3

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

log "release=${RELEASE} deployment=${DEPLOYMENT} service=${SERVICE} namespace=${NAMESPACE}"

# --- Helm / workload state -------------------------------------------------
if [[ "${SKIP_HELM}" -eq 0 ]]; then
  require_cmd helm
  log "helm status ${RELEASE}"
  HELM_STATUS="$(helm status "${RELEASE}" -n "${NAMESPACE}" -o json \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["info"]["status"])')"
  [[ "${HELM_STATUS}" == "deployed" ]] || fail "helm release ${RELEASE} status is '${HELM_STATUS}' (expected deployed)"
fi

wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600

log "pod phase and init containers"
POD="$(pod_name "${NAMESPACE}" "${RELEASE}")"
READY_LINE="$(kubectl -n "${NAMESPACE}" get pod "${POD}" \
  -o jsonpath='{.status.phase} {range .status.containerStatuses[*]}{.ready} {end}')"
printf '%s\n' "${READY_LINE}" | grep -q '^Running true' || fail "pod ${POD} not Running/Ready: ${READY_LINE}"
BAD_INIT="$(kubectl -n "${NAMESPACE}" get pod "${POD}" \
  -o jsonpath='{range .status.initContainerStatuses[*]}{.name}={.state.terminated.exitCode} {end}' \
  | tr ' ' '\n' | grep -v '=0$' | grep -v '^$' || true)"
[[ -z "${BAD_INIT}" ]] || fail "init container did not exit 0: ${BAD_INIT}"

log "service ports (5174/7879 targets only, never 7878)"
SVC_TARGETS="$(kubectl -n "${NAMESPACE}" get svc "${SERVICE}" \
  -o jsonpath='{range .spec.ports[*]}{.name}:{.port}->{.targetPort} {end}')"
printf '%s\n' "${SVC_TARGETS}" | grep -q 'webui:' || fail "service ${SERVICE} has no webui port: ${SVC_TARGETS}"
printf '%s\n' "${SVC_TARGETS}" | grep -q 'mcp:' || fail "service ${SERVICE} has no mcp port: ${SVC_TARGETS}"
! printf '%s\n' "${SVC_TARGETS}" | grep -q '7878' || fail "service ${SERVICE} exposes 7878: ${SVC_TARGETS}"

log "endpoints expose 5174 and 7879"
EP_PORTS="$(kubectl -n "${NAMESPACE}" get endpoints "${SERVICE}" \
  -o jsonpath='{range .subsets[*].ports[*]}{.port} {end}')"
printf '%s\n' "${EP_PORTS}" | grep -qw 5174 || fail "endpoints ${SERVICE} missing 5174 (got: ${EP_PORTS})"
printf '%s\n' "${EP_PORTS}" | grep -qw 7879 || fail "endpoints ${SERVICE} missing 7879 (got: ${EP_PORTS})"
! printf '%s\n' "${EP_PORTS}" | grep -qw 7878 || fail "endpoints ${SERVICE} expose 7878"

# --- Health / version ------------------------------------------------------
log "GET /api/health (in pod, container port ${WEBUI_CONTAINER_PORT})"
curl_health_in_pod "${NAMESPACE}" "${RELEASE}" "${WEBUI_CONTAINER_PORT}" 120 || fail "/api/health not reachable in pod"
HEALTH="$(kubectl_exec "${NAMESPACE}" "${RELEASE}" curl -fsS "http://127.0.0.1:${WEBUI_CONTAINER_PORT}/api/health")"
printf '%s\n' "${HEALTH}" | grep -q '"ok":true' || fail "/api/health envelope not ok"
printf '%s\n' "${HEALTH}" | grep -q 'bundledKtxVersion' || fail "/api/health missing bundledKtxVersion"

if [[ -n "${WEBUI_URL}" ]]; then
  log "GET ${WEBUI_URL}/api/health (external)"
  EXT_HEALTH="$(curl -fsS "${WEBUI_URL%/}/api/health")"
  printf '%s\n' "${EXT_HEALTH}" | grep -q '"ok":true' || fail "external /api/health not ok"
fi

# --- Secret directory writable by the runtime user (no EROFS) ----------------
if [[ "${SKIP_SECRETS}" -eq 0 ]]; then
  log "secrets dir: owner/mode, writable, file modes"
  SECRET_STAT="$(kubectl_exec "${NAMESPACE}" "${RELEASE}" stat -c '%a %u:%g' /data/lucy/.ktx/secrets)"
  [[ "${SECRET_STAT}" == "700 10001:10001" ]] || fail ".ktx/secrets is '${SECRET_STAT}' (expected '700 10001:10001')"
  kubectl_exec "${NAMESPACE}" "${RELEASE}" /bin/sh -ec '
    probe=/data/lucy/.ktx/secrets/.acceptance-write-probe
    : > "$probe" && rm -f "$probe"
  ' || fail ".ktx/secrets is not writable by the Lucy runtime user (EROFS / Permission denied)"
  BAD_MODES="$(kubectl_exec "${NAMESPACE}" "${RELEASE}" \
    find /data/lucy/.ktx/secrets -type f \( ! -perm 0600 -o ! -user 10001 \) | wc -l | tr -d ' ')"
  [[ "${BAD_MODES}" == "0" ]] || fail "${BAD_MODES} file(s) in .ktx/secrets are not 0600 owned by 10001"
  MOUNTS_ON_SECRETS="$(kubectl -n "${NAMESPACE}" get pod "${POD}" \
    -o jsonpath='{range .spec.containers[?(@.name=="lucy")].volumeMounts[*]}{.mountPath}{"\n"}{end}' \
    | grep -c '^/data/lucy/.ktx/secrets' || true)"
  [[ "${MOUNTS_ON_SECRETS}" == "0" ]] || fail "main container must not mount a volume over .ktx/secrets"
else
  log "secrets dir checks skipped (--skip-secrets-check)"
fi

# --- Content root ----------------------------------------------------------
POD_CONTENT_ROOT="$(kubectl -n "${NAMESPACE}" get pod "${POD}" \
  -o jsonpath='{.spec.containers[?(@.name=="lucy")].env[?(@.name=="LUCY_CONTENT_ROOT")].value}')"
log "LUCY_CONTENT_ROOT in pod spec: '${POD_CONTENT_ROOT}'"
if [[ -n "${EXPECT_CONTENT_ROOT}" ]]; then
  [[ "${POD_CONTENT_ROOT}" == "${EXPECT_CONTENT_ROOT}" ]] \
    || fail "LUCY_CONTENT_ROOT is '${POD_CONTENT_ROOT}', expected '${EXPECT_CONTENT_ROOT}'"
fi

# --- ktx -------------------------------------------------------------------
if [[ "${SKIP_KTX}" -eq 0 ]]; then
  EXPECTED_KTX="${KTX_VERSION:-${LUCY_EXPECTED_KTX_VERSION:-0.16.0}}"
  log "ktx --version (expect ${EXPECTED_KTX})"
  KTX_VER="$(kubectl_exec "${NAMESPACE}" "${RELEASE}" ktx --version)"
  printf '%s\n' "${KTX_VER}" | grep -q "${EXPECTED_KTX}" || fail "unexpected ktx version: ${KTX_VER}"

  for conn in "${CONNECTIONS[@]}"; do
    log "ktx connection test ${conn}"
    kubectl_exec "${NAMESPACE}" "${RELEASE}" \
      ktx --project-dir /data/lucy connection test "${conn}" >/dev/null \
      || fail "ktx connection test ${conn} failed"
  done

  log "ktx admin reindex --force"
  kubectl_exec "${NAMESPACE}" "${RELEASE}" \
    ktx --project-dir /data/lucy admin reindex --force --output json >"${TMP_DIR}/reindex.json" \
    || fail "ktx admin reindex failed"
fi

# --- MCP -------------------------------------------------------------------
if [[ "${SKIP_MCP}" -eq 0 ]]; then
  INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"acceptance","version":"1.0"}}}'

  log "MCP initialize without token (expect 401)"
  set +e
  MCP_NO_AUTH="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${PUBLIC_MCP_URL}" \
    -H 'Content-Type: application/json' -d "${INIT_BODY}")"
  set -e
  [[ "${MCP_NO_AUTH}" == "401" ]] || fail "expected MCP 401 without token, got ${MCP_NO_AUTH}"

  log "MCP initialize with token"
  INIT_RESP="$(mcp_post "${PUBLIC_MCP_URL}" "${TOKEN}" "${INIT_BODY}")"
  printf '%s\n' "${INIT_RESP}" | grep -q 'lucy-mcp-proxy' || fail "MCP initialize missing lucy-mcp-proxy"

  log "MCP tools/list"
  LIST_BODY='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  LIST_RESP="$(mcp_post "${PUBLIC_MCP_URL}" "${TOKEN}" "${LIST_BODY}")"
  printf '%s\n' "${LIST_RESP}" | grep -q 'tools' || fail "MCP tools/list unexpected response"
fi

log "OK — acceptance passed (release=${RELEASE} deployment=${DEPLOYMENT} service=${SERVICE})"
