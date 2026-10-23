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

# B3: the harness-prepared write of the DB password is mounted into the WebUI pod at
# the in-container path the rendered ktx.yaml references (`password: file:<path>`).
# prepare-environment already wrote the per-run reader password file at
# ${RUN_DIR}/checker/secrets/db-reader.password with mode 0600; we copy it into a
# K8s Secret so the helm chart can mount it as a volume without printing the value.
# The B3 step is OPT-IN: a run.json that does not declare db.secretName (e.g. a
# pre-B3 or B1-only run) skips the step entirely. The script never hardcodes the
# password or the Secret name.
DB_SECRET_NAME=""
DB_READER_PASSWORD_FILE=""
if python3 -c '
import json, sys
with open(sys.argv[1], "r") as f:
  d = json.load(f).get("db") or {}
  if not d.get("secretName"):
    sys.exit(1)
' "${RUN_JSON}" 2>/dev/null; then
  DB_SECRET_NAME="$(python3 -c '
import json, sys
with open(sys.argv[1], "r") as f:
  print(json.load(f)["db"]["secretName"])
' "${RUN_JSON}")"
  DB_READER_PASSWORD_FILE="$(python3 -c '
import json, sys
with open(sys.argv[1], "r") as f:
  print(json.load(f)["db"]["passwordFile"])
' "${RUN_JSON}")"
  [[ -n "${DB_READER_PASSWORD_FILE}" && -r "${DB_READER_PASSWORD_FILE}" ]] || \
    fail "run.json declares db.secretName=${DB_SECRET_NAME} but db.passwordFile is missing or unreadable; the B3 producer requires a per-run reader password file (run prepare-environment with --apply-db)"
  log "DB password Secret from file (value never printed) -> ${DB_SECRET_NAME}"
  kubectl -n "${NAMESPACE}" delete secret "${DB_SECRET_NAME}" --ignore-not-found >/dev/null
  kubectl -n "${NAMESPACE}" create secret generic "${DB_SECRET_NAME}" --from-file=password="${DB_READER_PASSWORD_FILE}" >/dev/null
fi

log "helm upgrade --install ${RELEASE} (image pinned by digest ${DIGEST})"
# B3: pass the DB Secret name (read from run.json's db.secretName) through to the chart so
# the rendered ktx.yaml's `password: file:<mountPath>/password` resolves to the in-container file.
# When the run did not opt into --apply-db, no Secret name is forwarded and the chart's default
# (no DB Secret volume) applies. bash 3.2 cannot safely expand an empty array under
# `set -u`, so we build the helm invocation string instead of an arg array.
HELM_EXTRA_ARGS=()
if [[ -n "${DB_SECRET_NAME}" ]]; then
  HELM_EXTRA_ARGS=(--set-string "db.existingSecret=${DB_SECRET_NAME}")
fi
if [[ ${#HELM_EXTRA_ARGS[@]} -gt 0 ]]; then
  helm upgrade --install "${RELEASE}" "${CHART}" -n "${NAMESPACE}" -f "${VALUES}" \
    --set "image.repository=${REPOSITORY}" \
    --set-string "image.digest=${DIGEST}" \
    --set-string "env.LUCY_PUBLIC_MCP_URL=${PUBLIC_MCP_URL}" \
    "${HELM_EXTRA_ARGS[@]}" \
    --wait --timeout 10m
else
  helm upgrade --install "${RELEASE}" "${CHART}" -n "${NAMESPACE}" -f "${VALUES}" \
    --set "image.repository=${REPOSITORY}" \
    --set-string "image.digest=${DIGEST}" \
    --set-string "env.LUCY_PUBLIC_MCP_URL=${PUBLIC_MCP_URL}" \
    --wait --timeout 10m
fi

POD="$(kubectl -n "${NAMESPACE}" get pods -l "app.kubernetes.io/instance=${RELEASE}" -o jsonpath='{.items[0].metadata.name}')"
log "seeding the synthetic fixture project into ${POD}:/data/lucy (no private configuration is ever copied)"
tar -C "${PROJECT_DIR}" -cf - . | kubectl -n "${NAMESPACE}" exec -i "${POD}" -c lucy -- tar -C /data/lucy -xf -
kubectl -n "${NAMESPACE}" rollout restart "deploy/${RELEASE}" >/dev/null
kubectl -n "${NAMESPACE}" rollout status "deploy/${RELEASE}" --timeout=600s >/dev/null

log "acceptance + what is actually deployed (digest and single-replica topology are read from the cluster)"
mkdir -p "${RUN_DIR}/results"

# Pull the run's logical instance UUID from run.json so the acceptance step can stamp it on
# deployment.json. k8s-acceptance.sh now requires --logical-instance-id whenever
# --deployment-evidence is used (B1 target-identity refuses missing field); the real
# physical Pod UID is measured inside the acceptance step and recorded separately.
LOGICAL_INSTANCE_ID="$(python3 -c '
import json, sys
with open(sys.argv[1], "r") as f:
    print(json.load(f)["instanceId"])
' "${RUN_JSON}")"
[[ -n "${LOGICAL_INSTANCE_ID}" ]] || fail "run.json is missing instanceId; run prepare-environment.mjs first"

bash "${ROOT}/scripts/gates/k8s-acceptance.sh" --namespace "${NAMESPACE}" --release "${RELEASE}" \
  --skip-mcp --skip-ktx --skip-secrets-check \
  --expect-image-digest "${DIGEST}" \
  --logical-instance-id "${LOGICAL_INSTANCE_ID}" \
  --deployment-evidence "${RUN_DIR}/results/deployment.json"
log "deployment evidence: ${RUN_DIR}/results/deployment.json (logicalInstanceId=${LOGICAL_INSTANCE_ID})"
