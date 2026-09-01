#!/usr/bin/env bash
# Smooth upgrade Lucy: rebuild the image while preserving /data/lucy runtime state
# (WebUI accounts, ACL, audit logs, secrets, ktx.yaml).
#
# Use --fresh to wipe the Lucy data volume and reseed from template (zero-state dev testing).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILES=("docker-compose.demo.yml")
FRESH=0
NO_CACHE=0
BACKUP_DIR=""
SKIP_HEALTH=0
SKIP_PRESERVE_CHECK=0
SERVICE="lucy"

usage() {
  cat <<'EOF'
Usage: upgrade-lucy.sh [options]

Smooth upgrade (default): rebuild/recreate the Lucy container without deleting /data/lucy.
Preserves WebUI admins, MCP ACL, audit logs, secrets, and project config when they already exist.

Options:
  -f, --compose-file FILE   Compose file (repeatable; default: docker-compose.demo.yml)
      --fresh               Wipe Lucy data volume and reseed from template
      --no-cache            Build image without Docker layer cache
      --backup-dir DIR      Tar backup of /data/lucy before upgrade (named volume only)
      --skip-health         Skip post-upgrade /api/health wait
      --skip-preserve-check Skip before/after preserve marker verification
  -h, --help                Show this help

Examples:
  npm run demo:upgrade
  bash scripts/upgrade-lucy.sh -f docker-compose.yml --backup-dir inbox/backups
  bash scripts/upgrade-lucy.sh --fresh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--compose-file)
      if [[ ${#COMPOSE_FILES[@]} -eq 1 && "${COMPOSE_FILES[0]}" == "docker-compose.demo.yml" ]]; then
        COMPOSE_FILES=()
      fi
      COMPOSE_FILES+=("$2")
      shift 2
      ;;
    --fresh)
      FRESH=1
      shift
      ;;
    --no-cache)
      NO_CACHE=1
      shift
      ;;
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    --skip-health)
      SKIP_HEALTH=1
      shift
      ;;
    --skip-preserve-check)
      SKIP_PRESERVE_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "${BUILDX_BUILDER:-}" in
  lucy-amd64|lucy-builder)
    echo "error: BUILDX_BUILDER=${BUILDX_BUILDER} is reserved for customer amd64 packaging" >&2
    echo "hint: unset BUILDX_BUILDER, then re-run $0" >&2
    exit 1
    ;;
esac

export BUILDX_BUILDER="${BUILDX_BUILDER:-default}"

case "$(uname -m)" in
  arm64|aarch64)
    export TARGETPLATFORM="${TARGETPLATFORM:-linux/arm64}"
    export TARGETARCH="${TARGETARCH:-arm64}"
    ;;
  x86_64|amd64)
    export TARGETPLATFORM="${TARGETPLATFORM:-linux/amd64}"
    export TARGETARCH="${TARGETARCH:-amd64}"
    ;;
  *)
    echo "error: unsupported host architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

COMPOSE=(docker compose)
for compose_file in "${COMPOSE_FILES[@]}"; do
  COMPOSE+=(-f "${compose_file}")
done
COMPOSE_FILE="${COMPOSE_FILES[-1]}"

readarray -t VOLUME_INFO < <(node "${ROOT}/scripts/upgrade-lucy-cli.mjs" volume-info --compose-file "${COMPOSE_FILE}")
VOLUME_KIND="${VOLUME_INFO[0]}"
VOLUME_LOGICAL="${VOLUME_INFO[1]:-}"
VOLUME_FULL="${VOLUME_INFO[2]:-}"
VOLUME_BIND="${VOLUME_INFO[3]:-}"

echo "[lucy-upgrade] compose=${COMPOSE_FILES[*]} mode=$([[ "${FRESH}" -eq 1 ]] && echo fresh || echo preserve) volume_kind=${VOLUME_KIND}"

snapshot_preserve_state() {
  if [[ "${VOLUME_KIND}" != "named" ]]; then
    return 0
  fi
  node "${ROOT}/scripts/upgrade-lucy-cli.mjs" snapshot \
    --volume "${VOLUME_FULL}" \
    --compose-file "${COMPOSE_FILE}"
}

maybe_backup_volume() {
  if [[ -z "${BACKUP_DIR}" || "${VOLUME_KIND}" != "named" ]]; then
    return 0
  fi
  mkdir -p "${BACKUP_DIR}"
  local stamp backup_file
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_file="${BACKUP_DIR}/lucy-data-${stamp}.tgz"
  echo "[lucy-upgrade] backing up ${VOLUME_FULL} -> ${backup_file}"
  docker run --rm \
    -v "${VOLUME_FULL}:/data/lucy:ro" \
    -v "${ROOT}/${BACKUP_DIR}:/backup" \
    busybox \
    tar czf "/backup/lucy-data-${stamp}.tgz" -C /data/lucy .
}

wipe_named_volume() {
  if [[ "${VOLUME_KIND}" != "named" ]]; then
    echo "[lucy-upgrade] --fresh with bind mount ${VOLUME_BIND}; remove contents manually if needed" >&2
    return 0
  fi
  echo "[lucy-upgrade] stopping ${SERVICE} and clearing volume ${VOLUME_FULL}"
  "${COMPOSE[@]}" stop "${SERVICE}" 2>/dev/null || true
  "${COMPOSE[@]}" rm -f "${SERVICE}" 2>/dev/null || true
  docker volume rm -f "${VOLUME_FULL}" 2>/dev/null || true
}

build_and_up() {
  if [[ "${NO_CACHE}" -eq 1 ]]; then
    "${COMPOSE[@]}" build --no-cache "${SERVICE}"
    "${COMPOSE[@]}" up -d --force-recreate --no-deps "${SERVICE}"
  else
    "${COMPOSE[@]}" up -d --build --force-recreate --no-deps "${SERVICE}"
  fi
}

wait_for_health() {
  if [[ "${SKIP_HEALTH}" -eq 1 ]]; then
    return 0
  fi
  local web_port="${LUCY_WEBUI_HOST_PORT:-}"
  if printf '%s\n' "${COMPOSE_FILES[@]}" | grep -q demo; then
    web_port="${LUCY_DEMO_WEBUI_HOST_PORT:-55176}"
  else
    web_port="${web_port:-5174}"
  fi
  local url="http://127.0.0.1:${web_port}/api/health"
  echo "[lucy-upgrade] waiting for ${url}"
  node -e '
    const url = process.argv[1];
    const deadline = Date.now() + 120_000;
    async function tick() {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const body = await res.json();
          if (body?.ok === true || body?.status === "ok") {
            console.log(JSON.stringify(body));
            process.exit(0);
          }
        }
      } catch {}
      if (Date.now() >= deadline) process.exit(1);
      setTimeout(tick, 1000);
    }
    tick();
  ' "${url}"
}

BEFORE_SNAPSHOT=""
if [[ "${FRESH}" -eq 0 && "${SKIP_PRESERVE_CHECK}" -eq 0 && "${VOLUME_KIND}" == "named" ]]; then
  BEFORE_SNAPSHOT="$(snapshot_preserve_state || true)"
fi

maybe_backup_volume

if [[ "${FRESH}" -eq 1 ]]; then
  wipe_named_volume
fi

build_and_up
wait_for_health

if [[ "${FRESH}" -eq 0 && "${SKIP_PRESERVE_CHECK}" -eq 0 && "${VOLUME_KIND}" == "named" && -n "${BEFORE_SNAPSHOT}" ]]; then
  AFTER_SNAPSHOT="$(snapshot_preserve_state || true)"
  node "${ROOT}/scripts/upgrade-lucy-cli.mjs" verify-snapshot \
    --before "${BEFORE_SNAPSHOT}" \
    --after "${AFTER_SNAPSHOT}"
fi

if [[ "${VOLUME_KIND}" == "named" ]]; then
  echo "[lucy-upgrade] ok volume=${VOLUME_FULL} preserved=$([[ "${FRESH}" -eq 1 ]] && echo false || echo true)"
else
  echo "[lucy-upgrade] ok bind_mount=${VOLUME_BIND} preserved=$([[ "${FRESH}" -eq 1 ]] && echo false || echo true)"
fi
