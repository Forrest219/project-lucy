#!/usr/bin/env bash
# Shared helpers for Lucy K8s release gates and acceptance scripts.
set -Eeuo pipefail

log() { printf '[k8s-gate] %s\n' "$*"; }
fail() { printf '[k8s-gate] FAIL: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

# Three names that are NOT always equal:
#   release     Helm release name (also the app.kubernetes.io/instance label)
#   deployment  workload name (chart fullname; `fullnameOverride` can differ from release)
#   service     Service name (same chart fullname unless overridden)
# Callers pass the release; set K8S_GATE_DEPLOYMENT / K8S_GATE_SERVICE when the
# environment keeps legacy names (e.g. release lucy-starrocks, deploy/svc lucy).
deployment_name() {
  local release="$1"
  printf '%s' "${K8S_GATE_DEPLOYMENT:-${release}}"
}

service_name() {
  local release="$1"
  printf '%s' "${K8S_GATE_SERVICE:-$(deployment_name "${release}")}"
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

# Pod selection goes through the Deployment's own selector so it keeps working
# when the Helm release name differs from the workload name.
pod_name() {
  local namespace="$1"
  local release="$2"
  local deploy selector
  deploy="$(deployment_name "${release}")"
  selector="$(kubectl -n "${namespace}" get deploy "${deploy}" \
    -o go-template='{{range $k,$v := .spec.selector.matchLabels}}{{$k}}={{$v}},{{end}}')"
  selector="${selector%,}"
  [[ -n "${selector}" ]] || fail "deployment ${deploy} has no selector"
  kubectl -n "${namespace}" get pods -l "${selector}" \
    -o jsonpath='{.items[0].metadata.name}'
}

kubectl_exec() {
  local namespace="$1"
  local release="$2"
  shift 2
  local pod
  pod="$(pod_name "${namespace}" "${release}")"
  kubectl -n "${namespace}" exec "${pod}" -c lucy -- "$@"
}

kubectl_exec_deploy() {
  local namespace="$1"
  local release="$2"
  shift 2
  kubectl -n "${namespace}" exec "deploy/$(deployment_name "${release}")" -c lucy -- "$@"
}

webui_base_url() {
  local namespace="$1"
  local release="$2"
  local webui_port="${3:-5174}"
  kubectl -n "${namespace}" port-forward "svc/$(service_name "${release}")" "${webui_port}:${webui_port}" >/dev/null 2>&1 &
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
    # Header goes through a 0600 temp file so the token never appears in the
    # process list (curl -H @file, curl >= 7.55).
    local hdr
    hdr="$(umask 077 && mktemp)"
    printf 'Authorization: Bearer %s\n' "${token}" > "${hdr}"
    local rc=0
    curl -fsS -X POST "${url}" \
      -H "Content-Type: application/json" \
      -H "@${hdr}" \
      -d "${body}" || rc=$?
    rm -f "${hdr}"
    return "${rc}"
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
  local pod
  pod="$(pod_name "${namespace}" "${release}")"
  kubectl -n "${namespace}" get pod "${pod}" \
    -o jsonpath='{.status.containerStatuses[?(@.name=="lucy")].imageID}'
}

# Sentinel paths relative to /data/lucy that must survive in-place upgrade.
# NOTE: /.ktx/secrets/demo-password is copied from the Secret by the
# secrets-sync init container (the Secret volume itself is read-only and only
# mounted at /mnt/lucy-secrets), so it is a regular PVC file after startup.
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
    # Synced from the Secret by the secrets-sync init; require the CI values key.
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

# Kubernetes fsGroup sets the setgid bit on PVC directories (mode 2700).
# That is not a world/group access bit: low 9 bits stay 0700 / 0600.
# Accept setgid only. Reject setuid, sticky, or any other low-9 mode.
secrets_mode_ok() {
  local mode="$1"
  local expect_low9="$2"
  python3 - "${mode}" "${expect_low9}" <<'PY'
import sys
mode = int(sys.argv[1], 8)
expect = int(sys.argv[2], 8)
if (mode & 0o777) != expect:
    sys.exit(1)
if (mode & 0o7000) not in (0, 0o2000):
    sys.exit(1)
PY
}

# stat -c '%a %u:%g' for the secrets directory.
# Owner must be 10001:10001; mode low 9 bits 0700; setgid allowed.
secrets_dir_stat_ok() {
  local line="$1"
  local mode owner uid gid
  mode="${line%% *}"
  owner="${line#* }"
  uid="${owner%%:*}"
  gid="${owner##*:}"
  [[ "${uid}" == "10001" && "${gid}" == "10001" ]] || return 1
  secrets_mode_ok "${mode}" 700
}

# stdin: one "MODE UID" line per file from stat -c '%a %u'. Empty is ok.
# Does not print paths or file contents.
secrets_file_stats_ok() {
  python3 -c "$(cat <<'PY'
import sys
bad = 0
for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    parts = line.split()
    if len(parts) < 2:
        bad += 1
        continue
    mode = int(parts[0], 8)
    uid = parts[1]
    if uid != "10001" or (mode & 0o777) != 0o600 or (mode & 0o7000) not in (0, 0o2000):
        bad += 1
if bad:
    print(
        f"{bad} file(s) in .ktx/secrets are not mode 0600 (setgid allowed) owned by 10001",
        file=sys.stderr,
    )
    sys.exit(1)
PY
)"
}

# stdin: MCP initialize JSON. Success is a JSON-RPC result with protocolVersion
# and serverInfo name+version. serverInfo.name is not fixed: a healthy proxy
# forwards the upstream name ("ktx"); "lucy-mcp-proxy" is only the local fallback.
# On failure print a short reason only — never the body (it carries instructions).
mcp_initialize_ok() {
  python3 -c "$(cat <<'PY'
import json
import sys

def reject(reason):
    print(reason, file=sys.stderr)
    sys.exit(1)

try:
    body = json.load(sys.stdin)
except json.JSONDecodeError:
    reject("MCP initialize response is not JSON")
if not isinstance(body, dict):
    reject("MCP initialize response is not an object")
if "error" in body:
    err = body.get("error")
    message = err.get("message") if isinstance(err, dict) else None
    reject("MCP initialize error: " + (str(message)[:200] if message else "JSON-RPC error"))
result = body.get("result")
if not isinstance(result, dict):
    reject("MCP initialize missing result")
if not result.get("protocolVersion"):
    reject("MCP initialize missing protocolVersion")
info = result.get("serverInfo")
if not isinstance(info, dict) or not info.get("name") or not info.get("version"):
    reject("MCP initialize missing serverInfo.name or serverInfo.version")
PY
)"
}

# stdin: MCP tools/list JSON. result.tools must be an array.
mcp_tools_list_ok() {
  python3 -c "$(cat <<'PY'
import json
import sys

def reject(reason):
    print(reason, file=sys.stderr)
    sys.exit(1)

try:
    body = json.load(sys.stdin)
except json.JSONDecodeError:
    reject("MCP tools/list response is not JSON")
if not isinstance(body, dict):
    reject("MCP tools/list response is not an object")
if "error" in body:
    err = body.get("error")
    message = err.get("message") if isinstance(err, dict) else None
    reject("MCP tools/list error: " + (str(message)[:200] if message else "JSON-RPC error"))
result = body.get("result")
if not isinstance(result, dict) or not isinstance(result.get("tools"), list):
    reject("MCP tools/list missing result.tools array")
PY
)"
}
