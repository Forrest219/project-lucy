#!/usr/bin/env bash
# Rebuild the local demo Lucy image/container on the host-native architecture.
# Preserves /data/lucy (accounts, ACL, audit logs). For a zero-state reseed use:
#   npm run demo:upgrade -- --fresh
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash "${ROOT}/scripts/upgrade-lucy.sh" -f docker-compose.demo.yml "$@"

case "$(uname -m)" in
  arm64|aarch64) TARGETARCH="${TARGETARCH:-arm64}" ;;
  x86_64|amd64) TARGETARCH="${TARGETARCH:-amd64}" ;;
  *) echo "error: unsupported host architecture: $(uname -m)" >&2; exit 1 ;;
esac

image_platform="$(docker image inspect project-lucy:demo --format '{{.Os}}/{{.Architecture}}' 2>/dev/null || true)"
TARGETPLATFORM="${TARGETPLATFORM:-linux/${TARGETARCH}}"
if [[ -n "${image_platform}" && "${image_platform}" != "${TARGETPLATFORM}" ]]; then
  echo "error: expected project-lucy:demo platform ${TARGETPLATFORM}, got ${image_platform}" >&2
  exit 1
fi

bash "${ROOT}/scripts/assert-image-elf-arch.sh" project-lucy:demo "${TARGETARCH}"
echo "[lucy-demo] ok image=${image_platform:-unknown} container=project-lucy-lucy-1"
