#!/usr/bin/env bash
# CI: H3 N-1 in-place upgrade + H4 rollback on a disposable kind cluster.
#
# Flow:
#   1. Build Lucy image locally (two tags: ci-n-1 / ci-n)
#   2. kind create + load images
#   3. helm install N-1 release on fresh PVC
#   4. scripts/k8s-upgrade-gate.sh (helm upgrade + H3 checks + optional H4)
#
# Environment:
#   KTX_VERSION              bundled KTX npm version (default: 0.16.0)
#   K8S_KIND_CLUSTER_NAME    kind cluster name (default: lucy-h3-gate-ci)
#   K8S_GATE_NAMESPACE       target namespace (default: lucy-gate)
#   K8S_GATE_RELEASE         helm release name (default: lucy)
#   K8S_GATE_IMAGE_REPO      local image repo (default: project-lucy)
#   K8S_GATE_IMAGE_N1_TAG     N-1 tag (default: ci-n-1)
#   K8S_GATE_IMAGE_N_TAG      upgrade target tag (default: ci-n)
#   K8S_GATE_TIMEOUT          helm --wait timeout (default: 20m)
#   K8S_GATE_SKIP_BUILD=1     skip docker build (image must already exist)
#   K8S_GATE_SKIP_H4=1        skip H4 rollback inside upgrade gate
#   K8S_GATE_KEEP_CLUSTER=1   do not delete kind cluster on exit
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/k8s-gate-lib.sh
source "${ROOT}/scripts/k8s-gate-lib.sh"

CHART="${ROOT}/deploy/k8s/helm/lucy"
VALUES_CI="${ROOT}/deploy/k8s/gate/values.gate-ci.yaml"

CLUSTER_NAME="${K8S_KIND_CLUSTER_NAME:-lucy-h3-gate-ci}"
NAMESPACE="${K8S_GATE_NAMESPACE:-lucy-gate}"
RELEASE="${K8S_GATE_RELEASE:-lucy}"
IMAGE_REPO="${K8S_GATE_IMAGE_REPO:-project-lucy}"
IMAGE_N1_TAG="${K8S_GATE_IMAGE_N1_TAG:-ci-n-1}"
IMAGE_N_TAG="${K8S_GATE_IMAGE_N_TAG:-ci-n}"
KTX_VERSION="${KTX_VERSION:-0.16.0}"
TIMEOUT="${K8S_GATE_TIMEOUT:-20m}"
SKIP_BUILD="${K8S_GATE_SKIP_BUILD:-0}"
SKIP_H4="${K8S_GATE_SKIP_H4:-0}"
KEEP_CLUSTER="${K8S_GATE_KEEP_CLUSTER:-0}"
UPGRADE_VALUES=""

usage() {
  cat <<'EOF'
Usage: bash scripts/k8s-kind-h3-gate.sh

Runs H3/H4 on a disposable kind cluster (CI-friendly). Requires docker, kind,
kubectl, and helm.
EOF
}

cleanup() {
  if [[ -n "${UPGRADE_VALUES}" && -f "${UPGRADE_VALUES}" ]]; then
    rm -f "${UPGRADE_VALUES}"
  fi
  if [[ "${KEEP_CLUSTER}" == "1" ]]; then
    log "K8S_GATE_KEEP_CLUSTER=1 — leaving kind cluster ${CLUSTER_NAME}"
    return 0
  fi
  log "deleting kind cluster ${CLUSTER_NAME}"
  kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1 (see --help)" ;;
  esac
done

require_cmd docker
require_cmd kind
require_cmd kubectl
require_cmd helm

[[ -f "${VALUES_CI}" ]] || fail "missing CI values: ${VALUES_CI}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
  log "building Lucy image (${IMAGE_REPO}:${IMAGE_N1_TAG} + ${IMAGE_N_TAG})"
  docker build \
    --build-arg "KTX_VERSION=${KTX_VERSION}" \
    --build-arg "TARGETPLATFORM=linux/amd64" \
    --build-arg "TARGETARCH=amd64" \
    -t "${IMAGE_REPO}:${IMAGE_N1_TAG}" \
    -t "${IMAGE_REPO}:${IMAGE_N_TAG}" \
    "${ROOT}"
else
  log "K8S_GATE_SKIP_BUILD=1 — using existing local image tags"
  docker image inspect "${IMAGE_REPO}:${IMAGE_N1_TAG}" >/dev/null 2>&1 || \
    fail "image not found: ${IMAGE_REPO}:${IMAGE_N1_TAG}"
  docker image inspect "${IMAGE_REPO}:${IMAGE_N_TAG}" >/dev/null 2>&1 || \
    fail "image not found: ${IMAGE_REPO}:${IMAGE_N_TAG}"
fi

if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  log "recycling existing kind cluster ${CLUSTER_NAME}"
  kind delete cluster --name "${CLUSTER_NAME}"
fi

log "creating kind cluster ${CLUSTER_NAME}"
kind create cluster --name "${CLUSTER_NAME}" --wait 300s

log "loading images into kind"
kind load docker-image "${IMAGE_REPO}:${IMAGE_N1_TAG}" --name "${CLUSTER_NAME}"
kind load docker-image "${IMAGE_REPO}:${IMAGE_N_TAG}" --name "${CLUSTER_NAME}"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

log "H3-prep: helm install N-1 (${IMAGE_N1_TAG})"
helm upgrade --install "${RELEASE}" "${CHART}" \
  --namespace "${NAMESPACE}" \
  -f "${VALUES_CI}" \
  --set "image.tag=${IMAGE_N1_TAG}" \
  --wait \
  --timeout "${TIMEOUT}"

wait_for_pod_ready "${NAMESPACE}" "${RELEASE}" 900

UPGRADE_VALUES="$(mktemp)"
sed "s/tag: \"ci-n-1\"/tag: \"${IMAGE_N_TAG}\"/" "${VALUES_CI}" >"${UPGRADE_VALUES}"

UPGRADE_ARGS=(
  --namespace "${NAMESPACE}"
  --release "${RELEASE}"
  -f "${UPGRADE_VALUES}"
)
if [[ "${SKIP_H4}" != "1" ]]; then
  UPGRADE_ARGS+=(--test-rollback)
fi

log "H3/H4: in-place upgrade gate (target tag ${IMAGE_N_TAG})"
bash "${ROOT}/scripts/k8s-upgrade-gate.sh" \
  --timeout "${TIMEOUT}" \
  "${UPGRADE_ARGS[@]}"

log "kind H3/H4 gate OK"
