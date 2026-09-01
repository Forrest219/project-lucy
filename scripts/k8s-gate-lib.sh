#!/usr/bin/env bash
# Shared helpers for Lucy K8s release gates and acceptance scripts.
set -Eeuo pipefail

log() { printf '[k8s-gate] %s\n' "$*"; }
fail() { printf '[k8s-gate] FAIL: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

deployment_name() {
  local release="$1"
  printf '%s' "${release}"
}

wait_for_pod_ready() {
  local namespace="$1"
  local release="$2"
  local timeout="${3:-600}"
  local deploy
  deploy="$(deployment_name "${release}")"
  log "waiting for deploy/${deploy} Ready in namespace ${namespace} (timeout ${timeout}s)"
  kubectl -n "${namespace}" rollout status "deploy/${deploy}" --timeout="${timeout}s"
  local ready
  ready="$(kubectl -n "${namespace}" get deploy "${deploy}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  [[ "${ready:-0}" == "1" ]] || fail "deployment ${deploy} is not 1/1 Ready"
}

pod_name() {
  local namespace="$1"
  local release="$2"
  kubectl -n "${namespace}" get pods \
    -l "app.kubernetes.io/instance=${release}" \
    -o jsonpath='{.items[0].metadata.name}'
}

kubectl_exec() {
  local namespace="$1"
  local release="$2"
  shift 2
  local pod
  pod="$(pod_name "${namespace}" "${release}")"
  kubectl -n "${namespace}" exec "${pod}" -- "$@"
}

webui_base_url() {
  local namespace="$1"
  local release="$2"
  local webui_port="${3:-5174}"
  kubectl -n "${namespace}" port-forward "svc/${release}" "${webui_port}:${webui_port}" >/dev/null 2>&1 &
  local pf_pid=$!
  # shellcheck disable=SC2064
  trap "kill ${pf_pid} >/dev/null 2>&1 || true" RETURN
  sleep 2
  printf 'http://127.0.0.1:%s' "${webui_port}"
}

curl_health() {
  local base_url="$1"
  curl -fsS "${base_url}/api/health"
}

mcp_post() {
  local url="$1"
  local token="${2:-}"
  local body="$3"
  if [[ -n "${token}" ]]; then
    curl -fsS -X POST "${url}" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${token}" \
      -d "${body}"
  else
    curl -fsS -X POST "${url}" \
      -H "Content-Type: application/json" \
      -d "${body}"
  fi
}
