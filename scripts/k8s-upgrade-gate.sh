#!/usr/bin/env bash
# H3 / H4 — automated in-place upgrade and rollback gates (requires live cluster).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/k8s-gate-lib.sh
source "${ROOT}/scripts/k8s-gate-lib.sh"

NAMESPACE=""
RELEASE=""
VALUES_FILE=""
CHART="${ROOT}/deploy/k8s/helm/lucy"
TEST_ROLLBACK=0
TIMEOUT="15m"

usage() {
  cat <<'EOF'
Usage: bash scripts/k8s-upgrade-gate.sh --namespace <ns> --release <name> -f <values.yaml> [options]

Runs H3 in-place upgrade verification on an existing release + PVC:
  - helm upgrade --atomic --wait (no manual git init/chown/kubectl set env)
  - access.yaml SHA256 unchanged
  - .git present on PVC with UID 10001 ownership
  - /api/health returns 200

Options:
  --chart <path>       Helm chart (default: deploy/k8s/helm/lucy)
  --test-rollback      Also run H4: helm rollback restores prior image digest
  --timeout <duration> Helm wait timeout (default: 15m)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    -f) VALUES_FILE="$2"; shift 2 ;;
    --chart) CHART="$2"; shift 2 ;;
    --test-rollback) TEST_ROLLBACK=1; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "${NAMESPACE}" ]] || fail "--namespace required"
[[ -n "${RELEASE}" ]] || fail "--release required"
[[ -n "${VALUES_FILE}" ]] || fail "-f <values.yaml> required"
[[ -f "${VALUES_FILE}" ]] || fail "values file not found: ${VALUES_FILE}"

require_cmd kubectl
require_cmd helm
require_cmd curl

kubectl -n "${NAMESPACE}" get deploy "${RELEASE}" >/dev/null 2>&1 || \
  fail "deployment ${RELEASE} not found in ${NAMESPACE} — H3 requires existing N-1 install"

log "H3-0 capture pre-upgrade state"
PRE_REVISION="$(helm history "${RELEASE}" -n "${NAMESPACE}" --max 1 -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["revision"])')"
PRE_IMAGE="$(kubectl -n "${NAMESPACE}" get deploy "${RELEASE}" -o jsonpath='{.spec.template.spec.containers[0].image}')"
PRE_ACCESS_HASH=""
if kubectl -n "${NAMESPACE}" exec deploy/"${RELEASE}" -- test -f /data/lucy/webui/config/access.yaml 2>/dev/null; then
  PRE_ACCESS_HASH="$(kubectl -n "${NAMESPACE}" exec deploy/"${RELEASE}" -- \
    sha256sum /data/lucy/webui/config/access.yaml | awk '{print $1}')"
  log "  pre access.yaml sha256=${PRE_ACCESS_HASH}"
else
  log "  warning: access.yaml not found pre-upgrade (fresh env?)"
fi

log "H3-1 helm upgrade --atomic --wait"
helm upgrade "${RELEASE}" "${CHART}" \
  --namespace "${NAMESPACE}" \
  -f "${VALUES_FILE}" \
  --atomic \
  --wait \
  --timeout "${TIMEOUT}"

wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600

log "H3-2 verify access.yaml preserved"
if [[ -n "${PRE_ACCESS_HASH}" ]]; then
  POST_ACCESS_HASH="$(kubectl -n "${NAMESPACE}" exec deploy/"${RELEASE}" -- \
    sha256sum /data/lucy/webui/config/access.yaml | awk '{print $1}')"
  [[ "${POST_ACCESS_HASH}" == "${PRE_ACCESS_HASH}" ]] || \
    fail "access.yaml hash changed: ${PRE_ACCESS_HASH} -> ${POST_ACCESS_HASH}"
  log "  ok access.yaml unchanged"
fi

log "H3-3 verify .git on PVC (entrypoint authority)"
kubectl -n "${NAMESPACE}" exec deploy/"${RELEASE}" -- test -d /data/lucy/.git || \
  fail "/data/lucy/.git missing after upgrade"
GIT_UID="$(kubectl -n "${NAMESPACE}" exec deploy/"${RELEASE}" -- \
  stat -c '%u' /data/lucy/.git 2>/dev/null || stat -f '%u' /data/lucy/.git)"
[[ "${GIT_UID}" == "10001" ]] || fail ".git owner UID=${GIT_UID}, expected 10001"
log "  ok .git owned by UID 10001"

log "H3-4 /api/health"
WEBUI_PORT="$(kubectl -n "${NAMESPACE}" get svc "${RELEASE}" -o jsonpath='{.spec.ports[?(@.name=="webui")].port}')"
[[ -n "${WEBUI_PORT}" ]] || fail "could not determine webui service port"
curl_health_in_pod "${NAMESPACE}" "${RELEASE}" "${WEBUI_PORT}" 60 || \
  fail "/api/health failed after upgrade"
log "  ok /api/health"

POST_IMAGE="$(kubectl -n "${NAMESPACE}" get deploy "${RELEASE}" -o jsonpath='{.spec.template.spec.containers[0].image}')"
log "  upgraded image: ${POST_IMAGE} (was ${PRE_IMAGE})"

if [[ "${TEST_ROLLBACK}" -eq 1 ]]; then
  log "H4-1 helm rollback to revision ${PRE_REVISION}"
  helm rollback "${RELEASE}" "${PRE_REVISION}" -n "${NAMESPACE}" --wait --timeout "${TIMEOUT}"
  wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600
  ROLL_IMAGE="$(kubectl -n "${NAMESPACE}" get deploy "${RELEASE}" -o jsonpath='{.spec.template.spec.containers[0].image}')"
  [[ "${ROLL_IMAGE}" == "${PRE_IMAGE}" ]] || \
    fail "rollback image mismatch: expected ${PRE_IMAGE}, got ${ROLL_IMAGE}"
  log "  ok rollback restored image ${ROLL_IMAGE}"
  log "H4-2 re-upgrade to target (restore test head)"
  helm upgrade "${RELEASE}" "${CHART}" \
    --namespace "${NAMESPACE}" \
    -f "${VALUES_FILE}" \
    --atomic \
    --wait \
    --timeout "${TIMEOUT}"
  wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600
fi

log "H3/H4 OK"
