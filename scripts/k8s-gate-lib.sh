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

kubectl_exec_deploy() {
  local namespace="$1"
  local release="$2"
  shift 2
  kubectl -n "${namespace}" exec "deploy/${release}" -- "$@"
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

curl_health_in_pod() {
  local namespace="$1"
  local release="$2"
  local webui_port="${3:-5174}"
  local timeout="${4:-60}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if kubectl_exec_deploy "${namespace}" "${release}" \
      curl -fsS "http://127.0.0.1:${webui_port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
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

# Actual runtime image identity (containerd/docker), not Deployment image string.
pod_image_id() {
  local namespace="$1"
  local release="$2"
  kubectl -n "${namespace}" get pod \
    -l "app.kubernetes.io/instance=${release}" \
    -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="lucy")].imageID}'
}

# Sentinel paths relative to /data/lucy that must survive in-place upgrade.
# NOTE: /.ktx/secrets is a projected Secret mount (read-only) — fingerprint an
# existing projected key instead of creating files there.
K8S_SENTINEL_PATHS=(
  ktx.yaml
  webui/config/access.yaml
  webui/config/admins.yaml
  .ktx/secrets/demo-password
  .ktx-ui/audit.sqlite
  semantic-layer/_gate/sentinel.yaml
  wiki/_gate/sentinel.md
  skills/_gate/sentinel.md
  .git/HEAD
)

seed_upgrade_sentinels() {
  local namespace="$1"
  local release="$2"
  kubectl_exec_deploy "${namespace}" "${release}" /bin/sh -ec '
    set -eu
    mkdir -p /data/lucy/webui/config \
      /data/lucy/.ktx-ui \
      /data/lucy/semantic-layer/_gate \
      /data/lucy/wiki/_gate \
      /data/lucy/skills/_gate
    printf "connections: {}\n# gate-sentinel-ktx\n" > /data/lucy/ktx.yaml
    printf "users: []\n# gate-sentinel-access\n" > /data/lucy/webui/config/access.yaml
    printf "admins: []\n# gate-sentinel-admins\n" > /data/lucy/webui/config/admins.yaml
    # Projected secret mount is read-only; require the CI values key to exist.
    test -f /data/lucy/.ktx/secrets/demo-password
    printf "SQLite format 3\000gate-sentinel-audit\n" > /data/lucy/.ktx-ui/audit.sqlite
    printf "name: gate_sentinel\n" > /data/lucy/semantic-layer/_gate/sentinel.yaml
    printf "# gate wiki sentinel\n" > /data/lucy/wiki/_gate/sentinel.md
    printf "# gate skill sentinel\n" > /data/lucy/skills/_gate/sentinel.md
    if [ ! -d /data/lucy/.git ]; then
      git init /data/lucy >/dev/null
    fi
    test -f /data/lucy/.git/HEAD
  '
}

capture_sentinel_hashes() {
  local namespace="$1"
  local release="$2"
  local out_file="$3"
  : > "${out_file}"
  local rel
  for rel in "${K8S_SENTINEL_PATHS[@]}"; do
    local hash
    hash="$(kubectl_exec_deploy "${namespace}" "${release}" \
      sha256sum "/data/lucy/${rel}" | awk '{print $1}')"
    printf '%s %s\n' "${hash}" "${rel}" >> "${out_file}"
  done
}

verify_sentinel_hashes() {
  local namespace="$1"
  local release="$2"
  local expected_file="$3"
  local tmp
  tmp="$(mktemp)"
  capture_sentinel_hashes "${namespace}" "${release}" "${tmp}"
  if ! diff -u "${expected_file}" "${tmp}" >/dev/null; then
    log "sentinel mismatch:"
    diff -u "${expected_file}" "${tmp}" >&2 || true
    rm -f "${tmp}"
    fail "customer-owned sentinel hashes changed after upgrade/rollback"
  fi
  rm -f "${tmp}"
  log "  ok sentinel hashes unchanged"
}

# Force PVC ownership for fixture A (UID 0) or B (UID 10001).
chown_pvc_via_helper() {
  local namespace="$1"
  local pvc_name="$2"
  local uid="$3"
  local helper="lucy-chown-${uid}-$$"
  kubectl -n "${namespace}" delete pod "${helper}" --ignore-not-found >/dev/null 2>&1 || true
  cat <<EOF | kubectl -n "${namespace}" apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: ${helper}
spec:
  restartPolicy: Never
  containers:
    - name: chown
      image: busybox:1.36
      command: ["sh", "-ec", "chown -R ${uid}:${uid} /data/lucy; ls -la /data/lucy"]
      securityContext:
        runAsUser: 0
      volumeMounts:
        - name: data
          mountPath: /data/lucy
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${pvc_name}
EOF
  kubectl -n "${namespace}" wait --for=jsonpath='{.status.phase}'=Succeeded "pod/${helper}" --timeout=120s
  kubectl -n "${namespace}" delete pod "${helper}" --ignore-not-found >/dev/null 2>&1 || true
}
