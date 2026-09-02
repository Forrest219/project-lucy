#!/usr/bin/env bash
# Helm static gates for Lucy K8s chart (G4 in customer-delivery-preflight-checklist).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART="${ROOT}/deploy/k8s/helm/lucy"
LOCAL_VALUES="${CHART}/examples/values.local-test.yaml"
K3S_VALUES="${CHART}/examples/values.k3s-test.yaml"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FAIL: missing required command: $1" >&2
    exit 1
  fi
}

require helm

echo "[helm-lucy-gate] helm lint"
helm lint "${CHART}"

echo "[helm-lucy-gate] helm template (local-test)"
LOCAL_RENDER="$(mktemp)"
helm template lucy "${CHART}" -f "${LOCAL_VALUES}" >"${LOCAL_RENDER}"

echo "[helm-lucy-gate] helm template (k3s-test)"
K3S_RENDER="$(mktemp)"
helm template lucy "${CHART}" -f "${K3S_VALUES}" >"${K3S_RENDER}"

assert_absent() {
  local file="$1"
  local pattern="$2"
  if grep -q "${pattern}" "${file}"; then
    echo "FAIL: rendered manifest must not contain pattern: ${pattern}" >&2
    exit 1
  fi
}

assert_present() {
  local file="$1"
  local pattern="$2"
  if ! grep -q "${pattern}" "${file}"; then
    echo "FAIL: rendered manifest must contain pattern: ${pattern}" >&2
    exit 1
  fi
}

for render in "${LOCAL_RENDER}" "${K3S_RENDER}"; do
  assert_absent "${render}" "runtime-preflight"
  assert_absent "${render}" "k8s-preflight.sh"
  assert_absent "${render}" "docker-healthcheck.sh"
  assert_absent "${render}" "GIT_CONFIG_COUNT"
  assert_present "${render}" "workingDir: /data/lucy"
  assert_present "${render}" "runAsUser: 10001"
  assert_present "${render}" "fsGroup: 10001"
  if grep -E '^[[:space:]]+port: 7878' "${render}" >/dev/null; then
    echo "FAIL: Service must not expose port 7878" >&2
    exit 1
  fi
  if grep -E '^[[:space:]]+targetPort: 7878' "${render}" >/dev/null; then
    echo "FAIL: Service must not target port 7878" >&2
    exit 1
  fi
  assert_present "${render}" "path: /api/health"
done

assert_present "${K3S_RENDER}" 'value: "http://10.69.95.109:8277/mcp"'
assert_present "${K3S_RENDER}" "containerPort: 5174"
assert_present "${K3S_RENDER}" "containerPort: 7879"
assert_present "${K3S_RENDER}" "port: 8276"
assert_present "${K3S_RENDER}" "port: 8277"
assert_present "${K3S_RENDER}" "type: LoadBalancer"
assert_present "${K3S_RENDER}" "name: project-migrate"

echo "[helm-lucy-gate] empty LUCY_PUBLIC_MCP_URL must fail for customer registry"
if helm template lucy "${CHART}" \
  --set image.repository=registry.example.com/data-team/project-lucy \
  --set env.LUCY_PUBLIC_MCP_URL="" >/dev/null 2>&1; then
  echo "FAIL: expected helm template to fail when LUCY_PUBLIC_MCP_URL is empty" >&2
  exit 1
fi

echo "[helm-lucy-gate] OK"
