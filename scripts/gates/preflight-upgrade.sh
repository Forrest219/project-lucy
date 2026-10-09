#!/usr/bin/env bash
# Pre-upgrade checks that need the live cluster (feedback 3.3 / 3.4 / 3.5).
#
# Default mode only reports. It does not patch the Deployment and does not
# edit files on the PVC. --apply-types and --apply-access are explicit.
#
# Works from the repo (scripts/gates/) and from an extracted package
# (scripts/preflight-upgrade.sh).
#
#   bash scripts/preflight-upgrade.sh \
#     --namespace lucy-test --release lucy-starrocks \
#     --deployment lucy --chart helm/lucy -f examples/values.k3s-test.yaml
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIFT_PY="${SCRIPT_DIR}/preflight_upgrade_drift.py"
LIB_MJS="${SCRIPT_DIR}/preflight-upgrade-lib.mjs"

if [[ -d "${SCRIPT_DIR}/../helm/lucy" ]]; then
  DEFAULT_CHART="${SCRIPT_DIR}/../helm/lucy"
else
  DEFAULT_CHART="$(cd "${SCRIPT_DIR}/../.." && pwd)/deploy/k8s/helm/lucy"
fi

NAMESPACE=""
RELEASE=""
DEPLOYMENT=""
CHART="${DEFAULT_CHART}"
VALUES=""
APPLY_TYPES=0
APPLY_ACCESS=0

usage() {
  cat <<'EOF'
Usage: bash scripts/preflight-upgrade.sh --namespace <ns> --release <helm-release> -f <values> [options]

Checks, then exits non-zero if any check fails. Does not modify the cluster
unless --apply-types or --apply-access is set (PVC files only; a backup is
written beside each changed file). The Deployment JSON Patch is printed for
review and is never applied.

Required:
  --namespace <ns>       Kubernetes namespace
  --release <name>       Helm release name used to render the chart
  -f, --values <file>    Values file, e.g. examples/values.k3s-test.yaml

Options:
  --deployment <name>    Deployment name (default: release name; lucy-test uses lucy)
  --chart <dir>          Helm chart (default: helm/lucy in a package, else deploy/k8s/helm/lucy)
  --apply-types          Rewrite mapped SQL Server column types on the PVC
  --apply-access         Remove AbsoluteDeny tools from roles.*.allow.tools only
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --deployment) DEPLOYMENT="$2"; shift 2 ;;
    --chart) CHART="$2"; shift 2 ;;
    -f|--values) VALUES="$2"; shift 2 ;;
    --apply-types) APPLY_TYPES=1; shift ;;
    --apply-access) APPLY_ACCESS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "${NAMESPACE}" && -n "${RELEASE}" && -n "${VALUES}" ]] || { usage >&2; exit 2; }
[[ -n "${DEPLOYMENT}" ]] || DEPLOYMENT="${RELEASE}"
[[ -f "${DRIFT_PY}" && -f "${LIB_MJS}" ]] || { echo "missing preflight helper next to this script" >&2; exit 2; }

for cmd in kubectl helm python3; do
  command -v "${cmd}" >/dev/null 2>&1 || { echo "missing required command: ${cmd}" >&2; exit 2; }
done

TMP="$(mktemp -d)"
cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT

echo "[preflight-upgrade] render ${CHART} release=${RELEASE}"
helm template "${RELEASE}" "${CHART}" -f "${VALUES}" -s templates/deployment.yaml >"${TMP}/desired.yaml"
kubectl apply --dry-run=client --validate=false -o json -f "${TMP}/desired.yaml" >"${TMP}/desired.json"
kubectl -n "${NAMESPACE}" get deploy "${DEPLOYMENT}" -o json >"${TMP}/live.json"

echo "[preflight-upgrade] deployment drift (command/args, extra volumes, extra init containers)"
set +e
python3 "${DRIFT_PY}" "${TMP}/desired.json" "${TMP}/live.json"
DRIFT_RC=$?
set -e
if [[ "${DRIFT_RC}" -ne 0 ]]; then
  echo "[preflight-upgrade] review the PATCH above, then apply it yourself if it matches the drift you expect:"
  echo "  kubectl -n ${NAMESPACE} patch deploy ${DEPLOYMENT} --type=json --patch-file <saved PATCH json>"
  echo "[preflight-upgrade] helm upgrade --force replaces the Deployment and is a fallback, not the default."
fi

echo "[preflight-upgrade] copy scanner into the pod"
kubectl -n "${NAMESPACE}" exec -i "deploy/${DEPLOYMENT}" -c lucy -- \
  sh -c 'cat > /tmp/preflight-upgrade-lib.mjs' <"${LIB_MJS}"

pod_node() {
  kubectl -n "${NAMESPACE}" exec "deploy/${DEPLOYMENT}" -c lucy -- \
    node /tmp/preflight-upgrade-lib.mjs "$@"
}

echo "[preflight-upgrade] semantic-layer column types"
set +e
pod_node scan-types /data/lucy/semantic-layer
TYPES_RC=$?
set -e

echo "[preflight-upgrade] access.yaml role tools"
set +e
pod_node scan-access /data/lucy/webui/config/access.yaml
ACCESS_RC=$?
set -e

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ "${APPLY_TYPES}" -eq 1 ]]; then
  echo "[preflight-upgrade] --apply-types (backup beside each rewritten file)"
  set +e
  pod_node apply-types /data/lucy/semantic-layer "${STAMP}"
  TYPES_RC=$?
  set -e
fi
if [[ "${APPLY_ACCESS}" -eq 1 ]]; then
  echo "[preflight-upgrade] --apply-access (roles.*.allow.tools only; defaults kept)"
  set +e
  pod_node apply-access /data/lucy/webui/config/access.yaml "${STAMP}"
  ACCESS_RC=$?
  set -e
fi

kubectl -n "${NAMESPACE}" exec "deploy/${DEPLOYMENT}" -c lucy -- \
  rm -f /tmp/preflight-upgrade-lib.mjs || true

if [[ "${DRIFT_RC}" -ne 0 || "${TYPES_RC}" -ne 0 || "${ACCESS_RC}" -ne 0 ]]; then
  echo "[preflight-upgrade] FAIL drift=${DRIFT_RC} types=${TYPES_RC} access=${ACCESS_RC}" >&2
  exit 1
fi
echo "[preflight-upgrade] OK"
