#!/usr/bin/env bash
# Helm static gates for Lucy K8s chart (H1 in customer-delivery-preflight-checklist).
#
# Runs unchanged from BOTH layouts:
#   repo:     scripts/gates/helm-lucy-gate.sh     chart deploy/k8s/helm/lucy
#   package:  scripts/preflight-helm.sh           chart helm/lucy  (run from the package root)
#
# H1a — universal chart contract (all profiles)
# H1b — k3s-test profile only (names, ports, content root, secrets, image identity)
#
# Usage: bash scripts/preflight-helm.sh [--k3s-only] [--chart DIR] [--k3s-values FILE]
#                                       [--release NAME]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "${SCRIPT_DIR}/../helm/lucy" ]]; then
  # Extracted delivery package: <pkg>/scripts/preflight-helm.sh
  ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
  CHART="${ROOT}/helm/lucy"
  PACKAGE_LAYOUT=1
else
  # Repository checkout: <repo>/scripts/gates/helm-lucy-gate.sh
  ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  CHART="${ROOT}/deploy/k8s/helm/lucy"
  PACKAGE_LAYOUT=0
fi
LOCAL_VALUES="${CHART}/examples/values.local-test.yaml"
# The package ships ONE k3s values file at <pkg>/examples/ (tag/digest synced at
# pack time); the chart-internal copy is a template and may hold placeholders.
if [[ -f "${ROOT}/examples/values.k3s-test.yaml" ]]; then
  K3S_VALUES="${ROOT}/examples/values.k3s-test.yaml"
else
  K3S_VALUES="${CHART}/examples/values.k3s-test.yaml"
fi
# Helm release used for the k3s render. It deliberately differs from the
# Deployment/Service name (fullnameOverride: lucy) to prove names are independent.
K3S_RELEASE="lucy-starrocks"
K3S_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chart) CHART="$2"; shift 2 ;;
    --k3s-values) K3S_VALUES="$2"; shift 2 ;;
    --local-values) LOCAL_VALUES="$2"; shift 2 ;;
    --release) K3S_RELEASE="$2"; shift 2 ;;
    --k3s-only) K3S_ONLY=1; shift ;;
    -h|--help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FAIL: missing required command: $1" >&2
    exit 1
  fi
}

require helm

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[helm-lucy-gate] chart=${CHART}"
echo "[helm-lucy-gate] helm lint"
helm lint "${CHART}" -f "${K3S_VALUES}"

LOCAL_RENDER=""
if [[ "${K3S_ONLY}" -eq 0 ]]; then
  echo "[helm-lucy-gate] helm template (local-test) — H1a universal"
  LOCAL_RENDER="${TMP_DIR}/local.yaml"
  helm template lucy "${CHART}" -f "${LOCAL_VALUES}" >"${LOCAL_RENDER}"
fi

echo "[helm-lucy-gate] helm template (k3s-test, release ${K3S_RELEASE}) — H1a + H1b profile"
K3S_RENDER="${TMP_DIR}/k3s.yaml"
helm template "${K3S_RELEASE}" "${CHART}" -f "${K3S_VALUES}" >"${K3S_RENDER}"

assert_absent() {
  local file="$1"
  local pattern="$2"
  if grep -q -- "${pattern}" "${file}"; then
    echo "FAIL: rendered manifest must not contain pattern: ${pattern}" >&2
    exit 1
  fi
}

assert_present() {
  local file="$1"
  local pattern="$2"
  if ! grep -q -- "${pattern}" "${file}"; then
    echo "FAIL: rendered manifest must contain pattern: ${pattern}" >&2
    exit 1
  fi
}

assert_env_value() {
  local file="$1"
  local name="$2"
  local value="$3"
  if ! grep -A1 -- "- name: ${name}" "${file}" | grep -q -- "value: \"${value}\""; then
    echo "FAIL: rendered manifest must contain ${name}=${value}" >&2
    exit 1
  fi
}

# Name of the first object of <kind> in a rendered manifest.
object_name() {
  local file="$1"
  local kind="$2"
  awk -v kind="${kind}" '
    /^---/ { want = 0; inmeta = 0 }
    $0 == "kind: " kind { want = 1 }
    /^metadata:/ { inmeta = 1; next }
    inmeta && want && /^  name: / { print $2; exit }
    /^[a-z]/ && !/^metadata:/ { inmeta = 0 }
  ' "${file}"
}

# Print the shell script of an init container (the `- |` block under command).
init_script() {
  local file="$1"
  local init_name="$2"
  awk -v want="- name: ${init_name}" '
    function indent(s) { match(s, /^ */); return RLENGTH }
    found == 0 { t = $0; sub(/^ +/, "", t); if (t == want) { found = 1 } ; next }
    found == 1 && /^ +- \|$/ { base = indent($0); found = 2; next }
    found == 2 {
      if ($0 ~ /^ *$/) { print ""; next }
      if (indent($0) <= base) { exit }
      print substr($0, base + 3)
    }
  ' "${file}"
}

assert_init_script_valid() {
  local render="$1"
  local init_name="$2"
  local script="${TMP_DIR}/${init_name}.sh"
  init_script "${render}" "${init_name}" >"${script}"
  if [[ ! -s "${script}" ]]; then
    echo "FAIL: could not extract init script ${init_name}" >&2
    exit 1
  fi
  if ! sh -n "${script}"; then
    echo "FAIL: init script ${init_name} has a shell syntax error" >&2
    exit 1
  fi
}

assert_universal_contract() {
  local render="$1"
  local label="$2"
  assert_absent "${render}" "runtime-preflight"
  assert_absent "${render}" "k8s-preflight.sh"
  assert_absent "${render}" "docker-healthcheck.sh"
  assert_absent "${render}" "GIT_CONFIG_COUNT"
  assert_present "${render}" "workingDir: /data/lucy"
  assert_present "${render}" "runAsUser: 10001"
  assert_present "${render}" "fsGroup: 10001"
  assert_present "${render}" "path: /api/health"
  assert_env_value "${render}" "LUCY_VERSION" "0.17.0"
  assert_env_value "${render}" "LUCY_BUNDLED_KTX_VERSION" "0.16.0"
  # A Secret volume is read-only: it must never shadow the WebUI-writable dir.
  assert_absent "${render}" "mountPath: /data/lucy/.ktx/secrets"
  if grep -E '^[[:space:]]+port: 7878' "${render}" >/dev/null; then
    echo "FAIL (${label}): Service must not expose port 7878" >&2
    exit 1
  fi
  if grep -E '^[[:space:]]+targetPort: 7878' "${render}" >/dev/null; then
    echo "FAIL (${label}): Service must not target port 7878" >&2
    exit 1
  fi
}

for render in "${LOCAL_RENDER}" "${K3S_RENDER}"; do
  [[ -n "${render}" ]] || continue
  assert_universal_contract "${render}" "all profiles"
done

echo "[helm-lucy-gate] H1a secrets-sync contract (any profile with a Secret)"
SECRET_RENDER="${TMP_DIR}/secret.yaml"
helm template lucy "${CHART}" --set existingSecret=customer-db >"${SECRET_RENDER}"
assert_universal_contract "${SECRET_RENDER}" "existingSecret"
assert_present "${SECRET_RENDER}" "name: secrets-sync"
assert_present "${SECRET_RENDER}" "mountPath: /mnt/lucy-secrets"
assert_present "${SECRET_RENDER}" "secretName: customer-db"
assert_present "${SECRET_RENDER}" "chmod 0700"
assert_present "${SECRET_RENDER}" "chmod 0600"
assert_present "${SECRET_RENDER}" "chown 10001:10001"
assert_init_script_valid "${SECRET_RENDER}" "secrets-sync"
assert_init_script_valid "${SECRET_RENDER}" "project-migrate"
# Only the init container may touch the Secret volume, and only read-only.
if [[ "$(grep -c -- 'name: secrets$' "${SECRET_RENDER}")" -ne 2 ]]; then
  echo "FAIL: Secret volume must be referenced by exactly one mount and one volume entry" >&2
  exit 1
fi
if grep -A3 -- 'mountPath: /mnt/lucy-secrets' "${SECRET_RENDER}" | grep -q 'readOnly: true'; then
  :
else
  echo "FAIL: /mnt/lucy-secrets must be mounted readOnly: true" >&2
  exit 1
fi
if grep -A20 'name: secrets-sync' "${SECRET_RENDER}" | grep -qE 'rm -[a-z]*[rf]'; then
  echo "FAIL: secrets-sync must never delete files (WebUI-created passwords live only on the PVC)" >&2
  exit 1
fi
# Without a Secret there must be no secrets-sync init and no Secret volume.
NOSECRET_RENDER="${TMP_DIR}/nosecret.yaml"
helm template lucy "${CHART}" >"${NOSECRET_RENDER}"
assert_absent "${NOSECRET_RENDER}" "name: secrets-sync"
assert_absent "${NOSECRET_RENDER}" "mountPath: /mnt/lucy-secrets"

echo "[helm-lucy-gate] stale lucy.version must fail"
if helm template lucy "${CHART}" --set-string lucy.version=0.16.0 >/dev/null 2>&1; then
  echo "FAIL: expected Helm render to reject lucy.version != Chart.appVersion" >&2
  exit 1
fi

echo "[helm-lucy-gate] H1b k3s-test profile checks"
assert_present "${K3S_RENDER}" 'value: "http://10.69.95.109:8277/mcp"'
assert_present "${K3S_RENDER}" "containerPort: 5174"
assert_present "${K3S_RENDER}" "containerPort: 7879"
assert_present "${K3S_RENDER}" "port: 8276"
assert_present "${K3S_RENDER}" "port: 8277"
assert_present "${K3S_RENDER}" "type: LoadBalancer"
assert_present "${K3S_RENDER}" "name: project-migrate"
assert_present "${K3S_RENDER}" "chown -h 10001:10001"
# Git init authority: entrypoint only — init must NOT git init
if grep -A25 'name: project-migrate' "${K3S_RENDER}" | grep -q 'git init'; then
  echo "FAIL: project-migrate must not run git init (entrypoint is authoritative)" >&2
  exit 1
fi

echo "[helm-lucy-gate] H1b existing-environment compatibility (names, PVC, content root)"
# Release is lucy-starrocks but the live objects are named `lucy`.
for kind in Deployment Service ServiceAccount; do
  got="$(object_name "${K3S_RENDER}" "${kind}")"
  if [[ "${got}" != "lucy" ]]; then
    echo "FAIL: ${kind} must be named 'lucy' (release ${K3S_RELEASE}); got '${got}'" >&2
    exit 1
  fi
done
assert_absent "${K3S_RENDER}" "name: ${K3S_RELEASE}$"
assert_present "${K3S_RENDER}" "claimName: lucy$"
assert_present "${K3S_RENDER}" "secretName: lucy-starrocks"
assert_env_value "${K3S_RENDER}" "LUCY_CONTENT_ROOT" "."
assert_present "${K3S_RENDER}" "name: secrets-sync"
assert_present "${K3S_RENDER}" "mountPath: /mnt/lucy-secrets"
assert_init_script_valid "${K3S_RENDER}" "secrets-sync"
assert_init_script_valid "${K3S_RENDER}" "project-migrate"
# Exactly two Service ports, targeting the named webui/mcp container ports.
SVC_PORTS="$(awk '
  /^---/ { insvc = 0 }
  $0 == "kind: Service" { insvc = 1 }
  insvc && /^[[:space:]]+targetPort:/ { print $2 }
' "${K3S_RENDER}" | sort | tr '\n' ' ')"
if [[ "${SVC_PORTS}" != "mcp webui " ]]; then
  echo "FAIL: Service must target only webui and mcp (got: ${SVC_PORTS})" >&2
  exit 1
fi

echo "[helm-lucy-gate] H1b image identity vs package metadata"
if [[ "${PACKAGE_LAYOUT}" -eq 1 && -f "${ROOT}/image/image-tag.txt" && -f "${ROOT}/image/image-repository.txt" ]]; then
  PKG_TAG="$(tr -d '[:space:]' < "${ROOT}/image/image-tag.txt")"
  PKG_REPO="$(tr -d '[:space:]' < "${ROOT}/image/image-repository.txt")"
  assert_present "${K3S_RENDER}" "image: \"${PKG_REPO}:${PKG_TAG}\""
  if [[ -f "${ROOT}/image/delivery-mode.txt" && "$(tr -d '[:space:]' < "${ROOT}/image/delivery-mode.txt")" == "offline" ]]; then
    assert_present "${K3S_RENDER}" "imagePullPolicy: Never"
  fi
  assert_absent "${K3S_RENDER}" "REPLACE-ME"
  echo "  ok image ${PKG_REPO}:${PKG_TAG}"
else
  echo "  skipped (repository checkout: tag is a pack-time placeholder)"
fi

echo "[helm-lucy-gate] local-test may use ClusterIP (not a universal LoadBalancer requirement)"
if [[ -n "${LOCAL_RENDER}" ]]; then
  assert_present "${LOCAL_RENDER}" "type: ClusterIP"
fi

echo "[helm-lucy-gate] empty LUCY_PUBLIC_MCP_URL must fail for customer registry"
if helm template lucy "${CHART}" \
  --set image.repository=registry.example.com/data-team/project-lucy \
  --set env.LUCY_PUBLIC_MCP_URL="" >/dev/null 2>&1; then
  echo "FAIL: expected helm template to fail when LUCY_PUBLIC_MCP_URL is empty" >&2
  exit 1
fi

echo "[helm-lucy-gate] MCP URL negative matrix must fail for customer registry"
MCP_BAD=(
  "REPLACE-ME"
  "not-a-url"
  "ftp://lucy.example.com/mcp"
  "http://localhost/mcp"
  "https://localhost/mcp"
  "http://127.0.0.1/mcp"
  "https://127.0.0.1/mcp"
  "http://[::1]/mcp"
  "http://0.0.0.0/mcp"
)
for bad in "${MCP_BAD[@]}"; do
  if helm template lucy "${CHART}" \
    --set image.repository=registry.example.com/data-team/project-lucy \
    --set-string "env.LUCY_PUBLIC_MCP_URL=${bad}" >/dev/null 2>&1; then
    echo "FAIL: expected reject for MCP URL ${bad}" >&2
    exit 1
  fi
done

echo "[helm-lucy-gate] MCP URL positive matrix must render"
MCP_GOOD=(
  "https://lucy.example.com/mcp"
  "https://gateway.example.com/lucy/mcp"
)
for good in "${MCP_GOOD[@]}"; do
  helm template lucy "${CHART}" \
    --set image.repository=registry.example.com/data-team/project-lucy \
    --set-string "env.LUCY_PUBLIC_MCP_URL=${good}" >/dev/null
done

echo "[helm-lucy-gate] OK"
