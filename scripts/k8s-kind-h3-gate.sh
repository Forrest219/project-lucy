#!/usr/bin/env bash
# CI: H3 real N-1 → N in-place upgrade + H4 rollback on a disposable kind cluster.
#
# Builds N-1 image+chart from deploy/k8s/gate/n1-baseline.txt (or K8S_GATE_N1_REF)
# and N from the current checkout. Asserts different image config IDs.
#
# Environment:
#   KTX_VERSION              bundled KTX npm version (default: 0.16.0)
#   K8S_GATE_N1_REF          override N-1 git ref (default: n1-baseline.txt)
#   K8S_KIND_CLUSTER_NAME    kind cluster name (default: lucy-h3-gate-ci)
#   K8S_GATE_NAMESPACE       target namespace prefix (default: lucy-gate)
#   K8S_GATE_RELEASE         helm release name (default: lucy)
#   K8S_GATE_IMAGE_REPO      local image repo (default: project-lucy)
#   K8S_GATE_IMAGE_N1_TAG    N-1 tag (default: ci-n-1)
#   K8S_GATE_IMAGE_N_TAG     upgrade target tag (default: ci-n)
#   K8S_GATE_TIMEOUT         helm --wait timeout (default: 20m)
#   K8S_GATE_SKIP_BUILD=1    skip docker build (images must already exist and differ)
#   K8S_GATE_SKIP_H4=1       skip H4 rollback inside upgrade gate
#   K8S_GATE_KEEP_CLUSTER=1  do not delete kind cluster on exit
#   K8S_GATE_FIXTURES        space-separated: "uid0 uid10001" (default both)
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/k8s-gate-lib.sh
source "${ROOT}/scripts/k8s-gate-lib.sh"

CHART_N="${ROOT}/deploy/k8s/helm/lucy"
VALUES_CI="${ROOT}/deploy/k8s/gate/values.gate-ci.yaml"
BASELINE_FILE="${ROOT}/deploy/k8s/gate/n1-baseline.txt"

CLUSTER_NAME="${K8S_KIND_CLUSTER_NAME:-lucy-h3-gate-ci}"
NAMESPACE_PREFIX="${K8S_GATE_NAMESPACE:-lucy-gate}"
RELEASE="${K8S_GATE_RELEASE:-lucy}"
IMAGE_REPO="${K8S_GATE_IMAGE_REPO:-project-lucy}"
IMAGE_N1_TAG="${K8S_GATE_IMAGE_N1_TAG:-ci-n-1}"
IMAGE_N_TAG="${K8S_GATE_IMAGE_N_TAG:-ci-n}"
KTX_VERSION="${KTX_VERSION:-0.16.0}"
TIMEOUT="${K8S_GATE_TIMEOUT:-20m}"
SKIP_BUILD="${K8S_GATE_SKIP_BUILD:-0}"
SKIP_H4="${K8S_GATE_SKIP_H4:-0}"
KEEP_CLUSTER="${K8S_GATE_KEEP_CLUSTER:-0}"
FIXTURES="${K8S_GATE_FIXTURES:-uid0 uid10001}"

N1_WORKTREE=""
EVIDENCE_ROOT=""
UPGRADE_VALUES=""

usage() {
  cat <<'EOF'
Usage: bash scripts/k8s-kind-h3-gate.sh

Runs real N-1→N H3/H4 on a disposable kind cluster. Requires docker, kind,
kubectl, helm, and git.
EOF
}

cleanup() {
  if [[ -n "${UPGRADE_VALUES}" && -f "${UPGRADE_VALUES}" ]]; then
    rm -f "${UPGRADE_VALUES}"
  fi
  if [[ -n "${N1_WORKTREE}" && -d "${N1_WORKTREE}" ]]; then
    git -C "${ROOT}" worktree remove --force "${N1_WORKTREE}" >/dev/null 2>&1 || \
      rm -rf "${N1_WORKTREE}"
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
require_cmd git

[[ -f "${VALUES_CI}" ]] || fail "missing CI values: ${VALUES_CI}"
[[ -f "${BASELINE_FILE}" ]] || fail "missing N-1 baseline file: ${BASELINE_FILE}"

N1_REF="${K8S_GATE_N1_REF:-}"
if [[ -z "${N1_REF}" ]]; then
  N1_REF="$(awk 'NF && $1 !~ /^#/ {print $1; exit}' "${BASELINE_FILE}")"
fi
N_REF="$(git -C "${ROOT}" rev-parse HEAD)"
[[ -n "${N1_REF}" ]] || fail "empty N-1 ref"
[[ "${N1_REF}" != "${N_REF}" ]] || fail "N-1 ref must differ from HEAD (${N_REF})"

EVIDENCE_ROOT="${ROOT}/inbox/k8s-h3-evidence-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${EVIDENCE_ROOT}"
{
  printf 'n1_ref=%s\n' "${N1_REF}"
  printf 'n_ref=%s\n' "${N_REF}"
  printf 'ktx_version=%s\n' "${KTX_VERSION}"
} > "${EVIDENCE_ROOT}/refs.txt"
log "evidence dir ${EVIDENCE_ROOT}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
  N1_WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/lucy-n1-wt.XXXXXX")"
  log "creating N-1 worktree at ${N1_REF} → ${N1_WORKTREE}"
  git -C "${ROOT}" worktree add --detach "${N1_WORKTREE}" "${N1_REF}"

  N1_CHART="${N1_WORKTREE}/deploy/k8s/helm/lucy"
  [[ -d "${N1_CHART}" ]] || fail "N-1 chart missing at ${N1_CHART}"

  log "building N-1 image from ${N1_REF} → ${IMAGE_REPO}:${IMAGE_N1_TAG}"
  docker build \
    --build-arg "KTX_VERSION=${KTX_VERSION}" \
    --build-arg "TARGETPLATFORM=linux/amd64" \
    --build-arg "TARGETARCH=amd64" \
    --build-arg "LUCY_GATE_BUILD_ID=n1-${N1_REF}" \
    -t "${IMAGE_REPO}:${IMAGE_N1_TAG}" \
    "${N1_WORKTREE}"

  log "building N image from ${N_REF} → ${IMAGE_REPO}:${IMAGE_N_TAG}"
  docker build \
    --build-arg "KTX_VERSION=${KTX_VERSION}" \
    --build-arg "TARGETPLATFORM=linux/amd64" \
    --build-arg "TARGETARCH=amd64" \
    --build-arg "LUCY_GATE_BUILD_ID=n-${N_REF}" \
    -t "${IMAGE_REPO}:${IMAGE_N_TAG}" \
    "${ROOT}"
else
  log "K8S_GATE_SKIP_BUILD=1 — using existing local image tags"
  docker image inspect "${IMAGE_REPO}:${IMAGE_N1_TAG}" >/dev/null 2>&1 || \
    fail "image not found: ${IMAGE_REPO}:${IMAGE_N1_TAG}"
  docker image inspect "${IMAGE_REPO}:${IMAGE_N_TAG}" >/dev/null 2>&1 || \
    fail "image not found: ${IMAGE_REPO}:${IMAGE_N_TAG}"
  if [[ -n "${K8S_GATE_N1_CHART:-}" ]]; then
    N1_CHART="${K8S_GATE_N1_CHART}"
  else
    N1_WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/lucy-n1-wt.XXXXXX")"
    log "creating N-1 chart worktree at ${N1_REF} → ${N1_WORKTREE}"
    git -C "${ROOT}" worktree add --detach "${N1_WORKTREE}" "${N1_REF}"
    N1_CHART="${N1_WORKTREE}/deploy/k8s/helm/lucy"
  fi
  [[ -d "${N1_CHART}" ]] || fail "N-1 chart missing at ${N1_CHART}"
fi

N1_CONFIG_ID="$(docker image inspect "${IMAGE_REPO}:${IMAGE_N1_TAG}" --format '{{.Id}}')"
N_CONFIG_ID="$(docker image inspect "${IMAGE_REPO}:${IMAGE_N_TAG}" --format '{{.Id}}')"
printf 'n1_config_id=%s\nn_config_id=%s\n' "${N1_CONFIG_ID}" "${N_CONFIG_ID}" \
  > "${EVIDENCE_ROOT}/image-config-ids.txt"
[[ "${N1_CONFIG_ID}" != "${N_CONFIG_ID}" ]] || \
  fail "N-1 and N image config IDs must differ (got ${N1_CONFIG_ID})"
log "N-1 config ID ${N1_CONFIG_ID}"
log "N   config ID ${N_CONFIG_ID}"

N1_CHART_VERSION="unknown"
N_CHART_VERSION="unknown"
if [[ -f "${N1_CHART}/Chart.yaml" ]]; then
  N1_CHART_VERSION="$(awk '/^version:/{print $2; exit}' "${N1_CHART}/Chart.yaml")"
fi
if [[ -f "${CHART_N}/Chart.yaml" ]]; then
  N_CHART_VERSION="$(awk '/^version:/{print $2; exit}' "${CHART_N}/Chart.yaml")"
fi
printf 'n1_chart=%s\nn_chart=%s\n' "${N1_CHART_VERSION}" "${N_CHART_VERSION}" \
  >> "${EVIDENCE_ROOT}/refs.txt"

if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  log "recycling existing kind cluster ${CLUSTER_NAME}"
  kind delete cluster --name "${CLUSTER_NAME}"
fi

log "creating kind cluster ${CLUSTER_NAME}"
kind create cluster --name "${CLUSTER_NAME}" --wait 300s

log "loading images into kind"
kind load docker-image "${IMAGE_REPO}:${IMAGE_N1_TAG}" --name "${CLUSTER_NAME}"
kind load docker-image "${IMAGE_REPO}:${IMAGE_N_TAG}" --name "${CLUSTER_NAME}"

run_fixture() {
  local fixture="$1"
  local ns="${NAMESPACE_PREFIX}-${fixture}"
  local evidence="${EVIDENCE_ROOT}/${fixture}"
  mkdir -p "${evidence}"

  log "=== fixture ${fixture} namespace=${ns} ==="
  kubectl delete namespace "${ns}" --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kubectl create namespace "${ns}"

  log "H3-prep: helm install N-1 (${IMAGE_N1_TAG}) with chart ${N1_CHART_VERSION}"
  helm upgrade --install "${RELEASE}" "${N1_CHART}" \
    --namespace "${ns}" \
    -f "${VALUES_CI}" \
    --set "image.tag=${IMAGE_N1_TAG}" \
    --wait \
    --timeout "${TIMEOUT}"

  wait_for_pod_ready "${ns}" "${RELEASE}" 900

  UPGRADE_VALUES="$(mktemp)"
  sed "s/tag: \"ci-n-1\"/tag: \"${IMAGE_N_TAG}\"/" "${VALUES_CI}" >"${UPGRADE_VALUES}"

  local fixture_uid=""
  case "${fixture}" in
    uid0) fixture_uid=0 ;;
    uid10001) fixture_uid=10001 ;;
    *) fail "unknown fixture: ${fixture}" ;;
  esac

  local upgrade_args=(
    --namespace "${ns}"
    --release "${RELEASE}"
    --chart "${CHART_N}"
    -f "${UPGRADE_VALUES}"
    --evidence-dir "${evidence}"
    --fixture-uid "${fixture_uid}"
  )
  if [[ "${SKIP_H4}" != "1" ]]; then
    upgrade_args+=(--test-rollback)
  fi

  log "H3/H4: in-place upgrade gate (target tag ${IMAGE_N_TAG}, fixture UID ${fixture_uid})"
  bash "${ROOT}/scripts/k8s-upgrade-gate.sh" \
    --timeout "${TIMEOUT}" \
    "${upgrade_args[@]}"

  rm -f "${UPGRADE_VALUES}"
  UPGRADE_VALUES=""
  log "fixture ${fixture} OK"
}

for fixture in ${FIXTURES}; do
  run_fixture "${fixture}"
done

log "kind H3/H4 gate OK (evidence: ${EVIDENCE_ROOT})"
