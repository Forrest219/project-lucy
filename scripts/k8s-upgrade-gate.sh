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
EVIDENCE_DIR=""
FIXTURE_UID=""

usage() {
  cat <<'EOF'
Usage: bash scripts/k8s-upgrade-gate.sh --namespace <ns> --release <name> -f <values.yaml> [options]

Runs H3 in-place upgrade verification on an existing release + PVC:
  - helm upgrade --atomic --wait (no manual git init/chown/kubectl set env)
  - customer-owned sentinel SHA256 unchanged
  - .git present on PVC with UID 10001 ownership
  - Pod status.containerStatuses[].imageID changes to target
  - /api/health returns 200

Options:
  --chart <path>         Helm chart (default: deploy/k8s/helm/lucy)
  --test-rollback        Also run H4: failed upgrade + rollback restores PRE imageID
  --timeout <duration>   Helm wait timeout (default: 15m)
  --evidence-dir <path>  Write PRE/TARGET/ROLLBACK imageID evidence
  --fixture-uid <0|10001>
                         After seeding sentinels, scale down, chown PVC, then upgrade
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
    --evidence-dir) EVIDENCE_DIR="$2"; shift 2 ;;
    --fixture-uid) FIXTURE_UID="$2"; shift 2 ;;
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

if [[ -n "${EVIDENCE_DIR}" ]]; then
  mkdir -p "${EVIDENCE_DIR}"
fi

SENTINEL_FILE="$(mktemp)"
cleanup_local() { rm -f "${SENTINEL_FILE}"; }
trap cleanup_local EXIT

log "H3-0 capture pre-upgrade state"
PRE_REVISION="$(helm history "${RELEASE}" -n "${NAMESPACE}" --max 1 -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["revision"])')"
PRE_IMAGE="$(kubectl -n "${NAMESPACE}" get deploy "${RELEASE}" -o jsonpath='{.spec.template.spec.containers[0].image}')"
PRE_IMAGE_ID="$(pod_image_id "${NAMESPACE}" "${RELEASE}")"
[[ -n "${PRE_IMAGE_ID}" ]] || fail "could not read PRE Pod imageID"
log "  PRE image=${PRE_IMAGE}"
log "  PRE imageID=${PRE_IMAGE_ID}"
if [[ -n "${EVIDENCE_DIR}" ]]; then
  printf '%s\n' "${PRE_IMAGE_ID}" > "${EVIDENCE_DIR}/imageid-pre.txt"
  printf '%s\n' "${PRE_IMAGE}" > "${EVIDENCE_DIR}/image-ref-pre.txt"
fi

log "H3-0b seed + capture sentinels"
seed_upgrade_sentinels "${NAMESPACE}" "${RELEASE}"
capture_sentinel_hashes "${NAMESPACE}" "${RELEASE}" "${SENTINEL_FILE}"
if [[ -n "${EVIDENCE_DIR}" ]]; then
  cp "${SENTINEL_FILE}" "${EVIDENCE_DIR}/sentinels-pre.txt"
fi

if [[ -n "${FIXTURE_UID}" ]]; then
  [[ "${FIXTURE_UID}" == "0" || "${FIXTURE_UID}" == "10001" ]] || \
    fail "--fixture-uid must be 0 or 10001"
  pvc="$(kubectl -n "${NAMESPACE}" get pvc -o jsonpath='{.items[0].metadata.name}')"
  [[ -n "${pvc}" ]] || fail "no PVC found for fixture chown"
  log "H3-0c fixture UID ${FIXTURE_UID}: scale down + chown PVC ${pvc}"
  kubectl -n "${NAMESPACE}" scale deploy "${RELEASE}" --replicas=0
  kubectl -n "${NAMESPACE}" wait --for=delete pod \
    -l "app.kubernetes.io/instance=${RELEASE}" --timeout=180s || true
  chown_pvc_via_helper "${NAMESPACE}" "${pvc}" "${FIXTURE_UID}"
fi

log "H3-1 helm upgrade --atomic --wait"
helm upgrade "${RELEASE}" "${CHART}" \
  --namespace "${NAMESPACE}" \
  -f "${VALUES_FILE}" \
  --atomic \
  --wait \
  --timeout "${TIMEOUT}"

wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600

TARGET_IMAGE_ID="$(pod_image_id "${NAMESPACE}" "${RELEASE}")"
[[ -n "${TARGET_IMAGE_ID}" ]] || fail "could not read TARGET Pod imageID"
[[ "${TARGET_IMAGE_ID}" != "${PRE_IMAGE_ID}" ]] || \
  fail "TARGET imageID equals PRE — upgrade did not change runtime image (${TARGET_IMAGE_ID})"
log "  TARGET imageID=${TARGET_IMAGE_ID}"
if [[ -n "${EVIDENCE_DIR}" ]]; then
  printf '%s\n' "${TARGET_IMAGE_ID}" > "${EVIDENCE_DIR}/imageid-target.txt"
fi

log "H3-2 verify sentinels preserved"
verify_sentinel_hashes "${NAMESPACE}" "${RELEASE}" "${SENTINEL_FILE}"

log "H3-3 verify .git on PVC (entrypoint authority)"
kubectl -n "${NAMESPACE}" exec deploy/"${RELEASE}" -- test -d /data/lucy/.git || \
  fail "/data/lucy/.git missing after upgrade"
GIT_UID="$(kubectl -n "${NAMESPACE}" exec deploy/"${RELEASE}" -- \
  stat -c '%u' /data/lucy/.git 2>/dev/null || true)"
[[ "${GIT_UID}" == "10001" ]] || fail ".git owner UID=${GIT_UID}, expected 10001"
log "  ok .git owned by UID 10001"

log "H3-4 /api/health"
WEBUI_PORT="$(kubectl -n "${NAMESPACE}" get svc "${RELEASE}" -o jsonpath='{.spec.ports[?(@.name=="webui")].port}')"
[[ -n "${WEBUI_PORT}" ]] || fail "could not determine webui service port"
curl_health_in_pod "${NAMESPACE}" "${RELEASE}" "${WEBUI_PORT}" 60 || \
  fail "/api/health failed after upgrade"
log "  ok /api/health"

POST_IMAGE="$(kubectl -n "${NAMESPACE}" get deploy "${RELEASE}" -o jsonpath='{.spec.template.spec.containers[0].image}')"
log "  upgraded image ref: ${POST_IMAGE} (was ${PRE_IMAGE})"

if [[ "${TEST_ROLLBACK}" -eq 1 ]]; then
  log "H4-0 induce failed upgrade (bad tag) — must not change PRE runtime identity after atomic rollback"
  set +e
  helm upgrade "${RELEASE}" "${CHART}" \
    --namespace "${NAMESPACE}" \
    -f "${VALUES_FILE}" \
    --set "image.tag=lucy-gate-does-not-exist-$$" \
    --atomic \
    --wait \
    --timeout 90s
  bad_rc=$?
  set -e
  [[ "${bad_rc}" -ne 0 ]] || fail "H4 expected bad upgrade to fail, but it succeeded"
  wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 300
  AFTER_BAD_ID="$(pod_image_id "${NAMESPACE}" "${RELEASE}")"
  # After atomic failure we should still be on TARGET (successful H3 head), not the bad tag.
  [[ "${AFTER_BAD_ID}" == "${TARGET_IMAGE_ID}" ]] || \
    fail "after failed upgrade imageID drifted: expected ${TARGET_IMAGE_ID}, got ${AFTER_BAD_ID}"
  log "  ok failed upgrade left runtime at TARGET imageID"

  log "H4-1 helm rollback to revision ${PRE_REVISION}"
  helm rollback "${RELEASE}" "${PRE_REVISION}" -n "${NAMESPACE}" --wait --timeout "${TIMEOUT}"
  wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600
  ROLL_IMAGE_ID="$(pod_image_id "${NAMESPACE}" "${RELEASE}")"
  [[ "${ROLL_IMAGE_ID}" == "${PRE_IMAGE_ID}" ]] || \
    fail "rollback imageID mismatch: expected ${PRE_IMAGE_ID}, got ${ROLL_IMAGE_ID}"
  log "  ok rollback restored imageID ${ROLL_IMAGE_ID}"
  if [[ -n "${EVIDENCE_DIR}" ]]; then
    printf '%s\n' "${ROLL_IMAGE_ID}" > "${EVIDENCE_DIR}/imageid-rollback.txt"
  fi

  verify_sentinel_hashes "${NAMESPACE}" "${RELEASE}" "${SENTINEL_FILE}"
  curl_health_in_pod "${NAMESPACE}" "${RELEASE}" "${WEBUI_PORT}" 60 || \
    fail "/api/health failed after rollback"

  log "H4-2 re-upgrade to target (restore test head)"
  helm upgrade "${RELEASE}" "${CHART}" \
    --namespace "${NAMESPACE}" \
    -f "${VALUES_FILE}" \
    --atomic \
    --wait \
    --timeout "${TIMEOUT}"
  wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 600
  FINAL_ID="$(pod_image_id "${NAMESPACE}" "${RELEASE}")"
  [[ "${FINAL_ID}" == "${TARGET_IMAGE_ID}" ]] || \
    fail "re-upgrade imageID mismatch: expected ${TARGET_IMAGE_ID}, got ${FINAL_ID}"
  verify_sentinel_hashes "${NAMESPACE}" "${RELEASE}" "${SENTINEL_FILE}"
fi

log "H3/H4 OK"
