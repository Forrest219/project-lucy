#!/usr/bin/env bash
# Helm static gates for Lucy K8s chart (H1 in customer-delivery-preflight-checklist).
#
# H1a — universal chart contract (all profiles)
# H1b — k3s-test profile only (LoadBalancer, external ports, MCP URL)
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART="${ROOT}/deploy/k8s/helm/lucy"
LOCAL_VALUES="${CHART}/examples/values.local-test.yaml"
K3S_VALUES="${CHART}/examples/values.k3s-test.yaml"
K3S_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chart) CHART="$2"; shift 2 ;;
    --k3s-values) K3S_VALUES="$2"; shift 2 ;;
    --local-values) LOCAL_VALUES="$2"; shift 2 ;;
    --k3s-only) K3S_ONLY=1; shift ;;
    -h|--help)
      sed -n '2,8p' "$0"
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

echo "[helm-lucy-gate] helm lint"
helm lint "${CHART}"

LOCAL_RENDER=""
if [[ "${K3S_ONLY}" -eq 0 ]]; then
  echo "[helm-lucy-gate] helm template (local-test) — H1a universal"
  LOCAL_RENDER="$(mktemp)"
  helm template lucy "${CHART}" -f "${LOCAL_VALUES}" >"${LOCAL_RENDER}"
fi

echo "[helm-lucy-gate] helm template (k3s-test) — H1a + H1b profile"
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

echo "[helm-lucy-gate] H1b k3s-test profile checks"
assert_present "${K3S_RENDER}" 'value: "http://10.69.95.109:8277/mcp"'
assert_present "${K3S_RENDER}" "containerPort: 5174"
assert_present "${K3S_RENDER}" "containerPort: 7879"
assert_present "${K3S_RENDER}" "port: 8276"
assert_present "${K3S_RENDER}" "port: 8277"
assert_present "${K3S_RENDER}" "type: LoadBalancer"
assert_present "${K3S_RENDER}" "name: project-migrate"
assert_present "${K3S_RENDER}" "chown -R 10001:10001 /data/lucy"
# Git init authority: entrypoint only — init must NOT git init
if grep -A20 'name: project-migrate' "${K3S_RENDER}" | grep -q 'git init'; then
  echo "FAIL: project-migrate must not run git init (entrypoint is authoritative)" >&2
  exit 1
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

echo "[helm-lucy-gate] OK"
