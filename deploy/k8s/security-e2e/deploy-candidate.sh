#!/usr/bin/env bash
# Deploys the ALREADY-GATED candidate image (by digest) into the isolated E2E namespace, seeds the synthetic
# fixture project, and records what is actually running. bash 3.2 compatible (no readarray/mapfile).
#
#   bash deploy/k8s/security-e2e/deploy-candidate.sh \
#     --run inbox/e2e/<runId>/run.json --namespace lucy-e2e --release lucy-e2e \
#     --repository ghcr.io/<org>/project-lucy --digest sha256:<64 hex> --public-mcp-url https://lucy-e2e.example.com/mcp
#
# Never prints a secret and never puts one on a command line: the bootstrap key reaches the cluster through
# `kubectl create secret --from-file`.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="${ROOT}/deploy/k8s/helm/lucy"
VALUES="${ROOT}/deploy/k8s/security-e2e/values.security-e2e.yaml"
RUN_JSON=""; NAMESPACE=""; RELEASE="lucy-e2e"; REPOSITORY=""; DIGEST=""; PUBLIC_MCP_URL=""

fail() { printf '[security-e2e] FAIL: %s\n' "$*" >&2; exit 1; }
log() { printf '[security-e2e] %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_JSON="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    --repository) REPOSITORY="$2"; shift 2 ;;
    --digest) DIGEST="$2"; shift 2 ;;
    --public-mcp-url) PUBLIC_MCP_URL="$2"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done
[[ -n "${RUN_JSON}" && -f "${RUN_JSON}" ]] || fail "--run <run.json> is required"
[[ -n "${NAMESPACE}" && -n "${REPOSITORY}" && -n "${PUBLIC_MCP_URL}" ]] || fail "--namespace, --repository and --public-mcp-url are required"
[[ "${DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "--digest must be the gated candidate digest sha256:<64 hex>"

RUN_DIR="$(cd "$(dirname "${RUN_JSON}")" && pwd)"
PROJECT_DIR="${RUN_DIR}/project"
BOOTSTRAP_FILE="${RUN_DIR}/checker/secrets/bootstrap-token"
[[ -d "${PROJECT_DIR}" ]] || fail "run project directory missing: ${PROJECT_DIR}"
[[ -r "${BOOTSTRAP_FILE}" ]] || fail "bootstrap key file missing (run prepare-environment.mjs first)"

command -v kubectl >/dev/null 2>&1 || fail "kubectl is required"
command -v helm >/dev/null 2>&1 || fail "helm is required"

kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1 || kubectl create namespace "${NAMESPACE}" >/dev/null
kubectl -n "${NAMESPACE}" apply -f "${ROOT}/deploy/k8s/security-e2e/networkpolicy.yaml" >/dev/null

log "bootstrap Secret from file (value never printed)"
kubectl -n "${NAMESPACE}" delete secret lucy-e2e-bootstrap --ignore-not-found >/dev/null
kubectl -n "${NAMESPACE}" create secret generic lucy-e2e-bootstrap --from-file=token="${BOOTSTRAP_FILE}" >/dev/null

log "helm upgrade --install ${RELEASE} (image pinned by digest ${DIGEST})"
helm upgrade --install "${RELEASE}" "${CHART}" -n "${NAMESPACE}" -f "${VALUES}" \
  --set "image.repository=${REPOSITORY}" \
  --set-string "image.digest=${DIGEST}" \
  --set-string "env.LUCY_PUBLIC_MCP_URL=${PUBLIC_MCP_URL}" \
  --wait --timeout 10m

POD="$(kubectl -n "${NAMESPACE}" get pods -l "app.kubernetes.io/instance=${RELEASE}" -o jsonpath='{.items[0].metadata.name}')"
log "seeding the synthetic fixture project into ${POD}:/data/lucy (no private configuration is ever copied)"
tar -C "${PROJECT_DIR}" -cf - . | kubectl -n "${NAMESPACE}" exec -i "${POD}" -c lucy -- tar -C /data/lucy -xf -
kubectl -n "${NAMESPACE}" rollout restart "deploy/${RELEASE}" >/dev/null
kubectl -n "${NAMESPACE}" rollout status "deploy/${RELEASE}" --timeout=600s >/dev/null

log "acceptance + what is actually deployed (digest and single-replica topology are read from the cluster)"
mkdir -p "${RUN_DIR}/results"
bash "${ROOT}/scripts/gates/k8s-acceptance.sh" --namespace "${NAMESPACE}" --release "${RELEASE}" \
  --skip-mcp --skip-ktx --skip-secrets-check \
  --expect-image-digest "${DIGEST}" \
  --deployment-evidence "${RUN_DIR}/results/deployment.json"
log "deployment evidence: ${RUN_DIR}/results/deployment.json"
