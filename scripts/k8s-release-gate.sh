#!/usr/bin/env bash
# Lucy K8s release gate orchestrator (H1–H5).
#
# Modes:
#   bash scripts/k8s-release-gate.sh                              # H1 static only
#   bash scripts/k8s-release-gate.sh --with-cluster --namespace lucy-test --release lucy-starrocks
#   bash scripts/k8s-release-gate.sh --with-cluster ... --test-upgrade -f examples/values.k3s-test.yaml
#
# Environment:
#   K8S_GATE_SKIP_KIND=1   skip H2–H4 even when --with-cluster (acceptance only)
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART="${ROOT}/deploy/k8s/helm/lucy"
GATE_VALUES="${ROOT}/deploy/k8s/gate/values.gate-fresh.yaml"

WITH_CLUSTER=0
TEST_UPGRADE=0
TEST_ROLLBACK=0
NAMESPACE=""
RELEASE="lucy"
VALUES_FILE=""
PUBLIC_MCP_URL=""
TOKEN=""
SKIP_MCP=1

usage() {
  cat <<'EOF'
Usage: bash scripts/k8s-release-gate.sh [options]

Options:
  --with-cluster             Run H2–H5 against an existing cluster (requires kubectl)
  --namespace <ns>           Target namespace (required with --with-cluster)
  --release <name>           Helm release name (default: lucy)
  --values-file <path>       Values for H3 upgrade (required with --test-upgrade)
  --test-upgrade             Run H3 in-place upgrade gate (requires existing release + PVC)
  --test-rollback            With --test-upgrade, also run H4 rollback digest check
  --public-mcp-url <url>     External MCP URL for H5 acceptance
  --token <bearer>           MCP bearer token for H5 acceptance
  --with-mcp                 Enable MCP checks in H5 (requires url + token)
  -h, --help                 Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-cluster) WITH_CLUSTER=1; shift ;;
    --test-upgrade) TEST_UPGRADE=1; shift ;;
    --test-rollback) TEST_ROLLBACK=1; shift ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --values-file|-f) VALUES_FILE="$2"; shift 2 ;;
    --public-mcp-url) PUBLIC_MCP_URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --with-mcp) SKIP_MCP=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

echo "[k8s-release-gate] H1 static helm gate"
bash "${ROOT}/scripts/helm-lucy-gate.sh"

if [[ "${WITH_CLUSTER}" -eq 0 ]]; then
  echo "[k8s-release-gate] skipping H2–H5 (no --with-cluster)"
  echo "[k8s-release-gate] OK (static only)"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { echo "FAIL: kubectl required for --with-cluster" >&2; exit 1; }
[[ -n "${NAMESPACE}" ]] || { echo "FAIL: --namespace required with --with-cluster" >&2; exit 1; }

if [[ "${K8S_GATE_SKIP_KIND:-}" == "1" ]]; then
  echo "[k8s-release-gate] K8S_GATE_SKIP_KIND=1 — skipping H2 fresh install render"
else
  echo "[k8s-release-gate] H2 fresh install render check"
  helm template "${RELEASE}" "${CHART}" -f "${GATE_VALUES}" >/dev/null
  echo "[k8s-release-gate] H2 render OK (apply on live cluster: helm install … -f deploy/k8s/gate/values.gate-fresh.yaml)"
fi

if [[ "${TEST_UPGRADE}" -eq 1 ]]; then
  [[ -n "${VALUES_FILE}" ]] || { echo "FAIL: --values-file required with --test-upgrade" >&2; exit 1; }
  UPGRADE_ARGS=(--namespace "${NAMESPACE}" --release "${RELEASE}" -f "${VALUES_FILE}")
  [[ "${TEST_ROLLBACK}" -eq 1 ]] && UPGRADE_ARGS+=(--test-rollback)
  echo "[k8s-release-gate] H3/H4 upgrade gate"
  bash "${ROOT}/scripts/k8s-upgrade-gate.sh" "${UPGRADE_ARGS[@]}"
else
  echo "[k8s-release-gate] skipping H3/H4 (no --test-upgrade)"
fi

echo "[k8s-release-gate] H5 post-deploy acceptance"
ACCEPT_ARGS=(--namespace "${NAMESPACE}" --release "${RELEASE}")
if [[ "${SKIP_MCP}" -eq 0 ]]; then
  [[ -n "${PUBLIC_MCP_URL}" ]] || { echo "FAIL: --public-mcp-url required with --with-mcp" >&2; exit 1; }
  [[ -n "${TOKEN}" ]] || { echo "FAIL: --token required with --with-mcp" >&2; exit 1; }
  ACCEPT_ARGS+=(--public-mcp-url "${PUBLIC_MCP_URL}" --token "${TOKEN}")
else
  ACCEPT_ARGS+=(--skip-mcp)
fi
bash "${ROOT}/scripts/k8s-acceptance.sh" "${ACCEPT_ARGS[@]}"

echo "[k8s-release-gate] OK"
